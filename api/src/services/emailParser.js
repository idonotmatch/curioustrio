const { complete } = require('./ai');
const { classifyExpenseItemType } = require('./itemClassifier');

const CLASSIFIER_SYSTEM_PROMPT = `You are an email expense classifier.
Given an email subject, sender, and a few body excerpts, classify it as one of:
- expense
- refund
- uncertain
- not_expense

Return ONLY a JSON object with:
- disposition (one of "expense", "refund", "uncertain", "not_expense")
- merchant (string or null)
- reason (short string or null)

Use "uncertain" when the email looks purchase-related but lacks a clearly readable final charge.
Use "not_expense" for newsletters, promos, shipping-only updates, account alerts, or non-purchase emails.
Do not include any text outside the JSON object.`;

const SYSTEM_PROMPT = `You are a receipt email parser. Extract purchase data from email receipts, order confirmations, and refund notifications.
Return ONLY a JSON object with:
- merchant (string)
- amount (number): the FINAL total actually charged to the payment method — this must include subtotal, shipping, tax, and any other fees. Do NOT use the subtotal. If the email shows "Order total: $53.42" or "Total charged: $53.42", use that number.
- date (ISO date string YYYY-MM-DD)
- notes (string or null)
- payment_method (string or null): one of "cash", "credit", "debit", or null if not visible. Infer "visa", "mastercard", "amex", "credit" as credit; "debit" as debit.
- card_label (string or null): card brand or nickname shown in the email when visible (for example "Visa", "Chase Sapphire", "Amex Gold"). null if not visible.
- card_last4 (string or null): the final 4 digits of the card if visible. null if not visible.
- items (array or null): individual line items from the email, each as { "description": string, "amount": number or null, "upc": string or null, "sku": string or null, "brand": string or null, "product_size": string or null, "pack_size": string or null, "unit": string or null }. Include product lines AND fees (shipping, tax, service fees, etc.) as separate items so that items sum to the total amount. For fee/tax/shipping lines set upc/sku/brand/product_size/pack_size/unit to null. Set items to null if the email does not list individual items.

Do NOT treat itinerary, reservation, guest, policy, loyalty-credit, support, or informational lines as items. Examples that should usually NOT become items: check-in/check-out times, guest names, cancellation policy text, "dollars used", "for more information", website links, confirmation headlines, or marketing upgrade offers unless they are clearly billed as purchased line items in an itemized block.

If the email describes a refund or return, set amount as a negative number.
If the email is not purchase/refund related, return null.
Do not include any text outside the JSON object.`;

function cleanText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function cleanStructuredText(value) {
  return (value || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function redactSensitiveText(value) {
  return (value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted-link]')
    .replace(/\b\d{12,}\b/g, '[redacted-number]')
    .replace(/\b\d{2,6}\s+[a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,5}\s(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place)\b/gi, '[redacted-address]');
}

function selectKeywordLines(structured = '', limit = 16) {
  return structured
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(line => /(total|charged|amount|payment|receipt|refund|return|order total|tax|shipping|service fee|subtotal|items|estimated total|seller|merchant|card)/i.test(line))
    .slice(0, limit);
}

function uniqueLines(lines = [], limit = 24) {
  const seen = new Set();
  const result = [];
  for (const rawLine of lines) {
    const line = `${rawLine || ''}`.trim();
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
    if (result.length >= limit) break;
  }
  return result;
}

function isSummaryLikeLine(line = '') {
  return /(total|subtotal|tax|shipping|service fee|delivery fee|tip|discount|savings|reward|charged|amount paid|order summary|receipt|merchant|seller|card)/i.test(line);
}

function isMoneyOnlyLine(line = '') {
  return /^\$?\s?-?\d+(?:\.\d{2})?$/.test(`${line || ''}`.trim());
}

function isPriceBearingLine(line = '') {
  return /\$\s?-?\d+(?:\.\d{2})?/.test(`${line || ''}`);
}

function isQuantityLine(line = '') {
  return /^(?:qty|quantity)?\s*x?\s*\d+\b/i.test(`${line || ''}`.trim());
}

function isSkuLikeLine(line = '') {
  return /^[A-Z0-9-]{5,}$/.test(`${line || ''}`.trim());
}

function isAddressLikeLine(line = '') {
  return /\b\d{2,6}\s+[a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,5}\s(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place)\b/i.test(`${line || ''}`);
}

function isClearlyNonItemLine(line = '') {
  const text = `${line || ''}`.trim();
  if (!text) return false;
  if (/\b(?:https?:\/\/|www\.|[a-z0-9.-]+\.(?:com|net|org|io|co|travel)\b)/i.test(text)) return true;
  if (/^(?:confirmed:?|confirmation:?|reservation:?|itinerary:?|created:?|guest name:?|room \d+\s+guest name:?|check-?in:?|check-?out:?|dollars used:?|for more information:?|how was your trip\??|provide feedback|view all items|payment method(?:\(s\))?:?|transaction id:?)/i.test(text)) return true;
  if (/(?:cancellation policy|policy deadlines|24-hour clock format|unless otherwise stated|cost\s*&\s*billing|terms\b|please visit\b|manage booking\b|view itinerary\b|order\s*#\s*\d{3,}|american express \*?\d{4}\b)/i.test(text)) return true;
  if (/\byour trip to\b/i.test(text)) return true;
  if (/\bwhen available\b/i.test(text)) return true;
  return false;
}

function isItemsPurchasedAnchor(line = '') {
  return /^items purchased(?::\s*\d+)?$/i.test(`${line || ''}`.trim());
}

function isUnitPriceQuantityLine(line = '') {
  return /^qty:\s*\d+\s*@\s*\$?\d+(?:\.\d{2})?\s*each$/i.test(`${line || ''}`.trim());
}

function parseUnitPriceQuantityLine(line = '') {
  const match = `${line || ''}`.match(/^qty:\s*(\d+)\s*@\s*\$?(\d+(?:\.\d{2})?)\s*each$/i);
  if (!match) return null;
  return {
    quantity: Number(match[1]),
    unitPrice: Number(match[2]),
  };
}

function isLikelyProductAnchor(line = '') {
  const text = `${line || ''}`.trim();
  if (!text) return false;
  if (text.length < 3 || text.length > 120) return false;
  if (isSummaryLikeLine(text) || isMoneyOnlyLine(text) || isAddressLikeLine(text)) return false;
  if (isClearlyNonItemLine(text)) return false;
  if (!/[a-z]/i.test(text)) return false;
  return true;
}

function selectBottomStructuredLines(structured = '', limit = 14) {
  return uniqueLines(
    structured
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-Math.max(limit * 2, 24))
      .reverse(),
    limit,
  ).reverse();
}

function selectItemLikeLines(structured = '', limit = 18) {
  return uniqueLines(
    structured
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => {
        if (isSummaryLikeLine(line)) return false;
        if (isMoneyOnlyLine(line)) return false;
        if (isClearlyNonItemLine(line)) return false;
        if (line.length < 3 || line.length > 80) return false;
        return /[a-z]/i.test(line);
      }),
    limit,
  );
}

function selectItemBlockLines(structured = '', limit = 32) {
  const lines = structured
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const collected = [];
  const seenIndexes = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isLikelyProductAnchor(line)) continue;

    let moneyIndex = -1;
    for (let offset = 0; offset <= 5; offset += 1) {
      const candidate = lines[index + offset];
      if (!candidate) break;
      if (isClearlyNonItemLine(candidate) && offset > 0) break;
      if (isSummaryLikeLine(candidate) && !isPriceBearingLine(candidate)) break;
      if (isPriceBearingLine(candidate) || isMoneyOnlyLine(candidate)) {
        moneyIndex = index + offset;
        break;
      }
    }

    if (moneyIndex === -1) continue;

    for (let cursor = index; cursor <= Math.min(moneyIndex, index + 5); cursor += 1) {
      const candidate = lines[cursor];
      if (!candidate || seenIndexes.has(cursor)) continue;
      if (isAddressLikeLine(candidate)) continue;
      if (isClearlyNonItemLine(candidate) && cursor !== moneyIndex) continue;
      if (
        cursor !== moneyIndex &&
        !isLikelyProductAnchor(candidate) &&
        !isSkuLikeLine(candidate) &&
        !isQuantityLine(candidate) &&
        !isPriceBearingLine(candidate)
      ) {
        continue;
      }
      collected.push(candidate);
      seenIndexes.add(cursor);
      if (collected.length >= limit) return collected;
    }
  }

  return uniqueLines(collected, limit);
}

function selectMoneyContextLines(structured = '', limit = 24) {
  const lines = structured
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const selected = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/(total|subtotal|tax|shipping|service fee|delivery fee|tip|discount|savings|charged|amount paid|order total|grand total|estimated total|refund total|refund amount)/i.test(line)) {
      continue;
    }
    selected.push(line);
    if (lines[index - 1] && /^\$?\s?-?\d+(?:\.\d{2})?$/.test(lines[index - 1])) {
      selected.push(lines[index - 1]);
    }
    for (let offset = 1; offset <= 5; offset += 1) {
      const nextLine = lines[index + offset];
      if (!nextLine || !/^\$?\s?-?\d+(?:\.\d{2})?$/.test(nextLine)) break;
      selected.push(nextLine);
    }
  }

  return uniqueLines(selected, limit);
}

function analyzeEmailSignals(subject = '', fromAddress = '', emailBody = '') {
  const text = `${subject}\n${fromAddress}\n${emailBody}`.toLowerCase();
  const senderLooksTransactional = /@(amazon|walmart|target|uber|lyft|lyftmail|ubereats|instacart|doordash|stripe|shopify|square|paypal|apple|google|expedia|delta|united|airbnb|booking|hilton|marriott|costco|bestbuy|etsy|ebay|wayfair|chewy|seamless|grubhub)\./i.test(fromAddress);
  const negativeSignals = /(tracking|shipped|out for delivery|delivered|newsletter|unsubscribe|promotion|sale ends|weekly digest|security alert|sign in|password reset|view in browser|manage preferences)/i.test(text);
  const transactionalContext = /(receipt|order|confirmation|purchase|charged|invoice|payment|refund|return|renewal|booking|subscription|trip|reservation)/i.test(text);
  const strongMoneySignal = /(?:order total|total charged|amount charged|amount paid|payment total|grand total|refund amount|refund total|you paid|charged to)[^$\d]{0,30}\$?\s?-?\d+(?:\.\d{2})?/i.test(text);
  const mediumMoneySignal = /(?:\btotal\b|\binvoice amount\b|\bpayment received\b|\bamount\b)[^$\d]{0,20}\$?\s?-?\d+(?:\.\d{2})?/i.test(text)
    || (/\$\s?-?\d+(?:\.\d{2})?/.test(text) && transactionalContext);
  const weakMoneySignal = /(?:save|from|starting at|under|up to|earn|credit|discount)[^$\d]{0,20}\$?\s?\d+(?:\.\d{2})?/i.test(text)
    || /\$\s?\d+(?:\.\d{2})?/.test(text);

  const shouldSurfaceToReview = strongMoneySignal
    || (mediumMoneySignal && (transactionalContext || senderLooksTransactional))
    || (transactionalContext && senderLooksTransactional && /\$\s?-?\d+(?:\.\d{2})?/.test(text));

  return {
    senderLooksTransactional,
    negativeSignals,
    transactionalContext,
    strongMoneySignal,
    mediumMoneySignal,
    weakMoneySignal,
    shouldSurfaceToReview,
  };
}

function classifyEmailModality(subject = '', fromAddress = '', emailBody = '') {
  const text = `${subject}\n${fromAddress}\n${emailBody}`.toLowerCase();
  const hasShippingSignals = /(tracking|shipped|out for delivery|delivered|estimated delivery|ship to|shipment|package)/i.test(text);
  const hasDigitalSignals = /(subscription|renewal|streaming|digital receipt|ebook|download|membership)/i.test(text);
  const hasPickupSignals = /(pickup|pick up|curbside|ready for pickup|ready for pick up|in store pickup|store pickup)/i.test(text);
  const hasInStoreSignals = /(in-store|instore|store #|register|terminal|lane \d+|thanks for shopping with us today|receipt|visited|cashier)/i.test(text);
  const hasAddressLikeSignal = /\b\d{2,6}\s+[a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,5}\s(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place)\b/i.test(text);

  if (hasShippingSignals) return 'delivery';
  if (hasDigitalSignals && !hasInStoreSignals && !hasPickupSignals) return 'digital';
  if (hasPickupSignals) return 'pickup';
  if (hasInStoreSignals || hasAddressLikeSignal) return 'in_person';
  if (/(order confirmation|order total|your order|placed your order|delivery order)/i.test(text)) return 'online';
  return 'unknown';
}

function extractEmailLocationCandidate(subject = '', fromAddress = '', emailBody = '') {
  const text = `${subject}\n${emailBody}`;
  const storeNumberMatch = text.match(/\bstore\s*#?\s*([a-z0-9-]{1,12})\b/i);
  const addressMatch = text.match(/\b\d{2,6}\s+[a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,5}\s(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place)\b(?:,?\s+[a-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)?/i);
  const cityStateZipMatch = text.match(/\b([A-Z][a-zA-Z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)\b/);

  const address = addressMatch?.[0]?.replace(/\s+/g, ' ').trim() || null;
  const cityState = cityStateZipMatch?.[1]?.replace(/\s+/g, ' ').trim() || null;
  const storeNumber = storeNumberMatch?.[1] || null;

  if (!address && !cityState && !storeNumber) return null;
  return {
    address,
    city_state: cityState,
    store_number: storeNumber,
  };
}

function selectRelevantEmailText(emailBody, snippet = '') {
  const cleaned = cleanText(redactSensitiveText(emailBody));
  const structured = cleanStructuredText(redactSensitiveText(emailBody));
  const normalizedSnippet = cleanText(redactSensitiveText(snippet));
  const structuredSnippet = cleanStructuredText(redactSensitiveText(snippet));
  if (!cleaned) return { classifierText: '', extractionText: '' };

  const topStructured = structured.slice(0, 1200);
  const bottomStructured = selectBottomStructuredLines(structured, 14).join('\n');
  const keywordLines = uniqueLines([
    ...selectKeywordLines(structured, 16),
    ...selectMoneyContextLines(structured, 24),
  ], 24).join('\n');
  const itemBlockLines = selectItemBlockLines(structured, 32).join('\n');
  const itemLines = selectItemLikeLines(structured, 18).join('\n');
  const focusedSummary = [normalizedSnippet, keywordLines, bottomStructured, topStructured]
    .filter(Boolean)
    .join('\n...\n');

  const classifierText = focusedSummary.slice(0, 1800);

  const extractionText = [structuredSnippet, keywordLines, itemBlockLines, itemLines, bottomStructured, topStructured]
    .filter(Boolean)
    .join('\n...\n')
    .slice(0, 3600);

  return { classifierText, extractionText };
}

function heuristicDisposition(subject = '', fromAddress = '', emailBody = '') {
  const signals = analyzeEmailSignals(subject, fromAddress, emailBody);
  if (!signals.shouldSurfaceToReview && signals.negativeSignals && !signals.strongMoneySignal && !signals.mediumMoneySignal) {
    return 'not_expense';
  }
  return null;
}

function parseJsonResponse(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!cleaned || cleaned === 'null') return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function parsePriceValue(line = '') {
  const match = `${line || ''}`.match(/\$?\s?(-?\d+(?:\.\d{2})?)/);
  return match ? Number(match[1]) : null;
}

function extractDeterministicTotalAmount(emailBody = '') {
  const structured = cleanStructuredText(redactSensitiveText(emailBody));
  if (!structured) return null;

  const lines = structured
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = [];
  const exactLabelPattern = /^(grand total|order total|total charged|amount charged|amount paid|payment total|refund total|refund amount|total)$/i;
  const inlineLabelPattern = /\b(grand total|order total|total charged|amount charged|amount paid|payment total|refund total|refund amount|total(?!\s+savings))\b[^$\d-]{0,20}\$?\s?(-?\d+(?:\.\d{2})?)/gi;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inlineMatches = [...line.matchAll(inlineLabelPattern)];
    if (inlineMatches.length > 0) {
      for (const match of inlineMatches) {
        const amount = Number(match[2]);
        if (Number.isFinite(amount) && amount !== 0) {
          candidates.push(amount);
        }
      }
      continue;
    }

    if (/^total savings$/i.test(line)) continue;
    if (!exactLabelPattern.test(line)) continue;
    const nextLine = lines[index + 1];
    const amount = parsePriceValue(nextLine);
    if (Number.isFinite(amount) && amount !== 0) {
      candidates.push(amount);
    }
  }

  return candidates.length ? candidates[candidates.length - 1] : null;
}

function extractDiscountLikeAmounts(emailBody = '') {
  const structured = cleanStructuredText(redactSensitiveText(emailBody));
  if (!structured) return [];

  const lines = structured
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = [];
  const inlinePattern = /\b(total savings|savings|discount|reward|promotions? applied|credit applied)\b[^$\d-]{0,20}\$?\s?(-?\d+(?:\.\d{2})?)/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inlineMatch = line.match(inlinePattern);
    if (inlineMatch) {
      const amount = Math.abs(Number(inlineMatch[2]));
      if (Number.isFinite(amount) && amount > 0) candidates.push(amount);
      continue;
    }

    if (!/\b(total savings|savings|discount|reward|promotions? applied|credit applied)\b/i.test(line)) continue;
    const nextLine = lines[index + 1];
    const amount = Math.abs(Number(parsePriceValue(nextLine)));
    if (Number.isFinite(amount) && amount > 0) candidates.push(amount);
  }

  return candidates;
}

function looksLikeBrandLine(line = '') {
  const text = `${line || ''}`.trim();
  if (!text || isSummaryLikeLine(text) || isSkuLikeLine(text) || isQuantityLine(text) || isMoneyOnlyLine(text)) return false;
  return /\b(coffee|roasters|company|co\.?|inc\.?|llc|market|foods|kitchen|bakery|shop|store)\b/i.test(text);
}

function extractItemsPurchasedSectionItems(lines = []) {
  const anchorIndex = lines.findIndex((line) => isItemsPurchasedAnchor(line));
  if (anchorIndex === -1) return [];

  const items = [];
  const sectionLines = lines.slice(anchorIndex + 1);

  for (let index = 0; index < sectionLines.length; index += 1) {
    const line = sectionLines[index];
    if (!isUnitPriceQuantityLine(line)) continue;

    const qtyData = parseUnitPriceQuantityLine(line);
    if (!qtyData) continue;

    const amountLine = sectionLines[index + 1];
    const amount = amountLine ? parsePriceValue(amountLine) : null;
    const finalAmount = Number.isFinite(amount) && amount > 0
      ? amount
      : Number((qtyData.quantity * qtyData.unitPrice).toFixed(2));

    const descriptionLines = [];
    for (let cursor = index - 1; cursor >= 0 && descriptionLines.length < 3; cursor -= 1) {
      const candidate = `${sectionLines[cursor] || ''}`.trim();
      if (!candidate) break;
      if (
        isItemsPurchasedAnchor(candidate)
        || isMoneyOnlyLine(candidate)
        || isPriceBearingLine(candidate)
        || isUnitPriceQuantityLine(candidate)
        || isSummaryLikeLine(candidate)
        || isClearlyNonItemLine(candidate)
      ) {
        break;
      }
      descriptionLines.unshift(candidate);
    }

    const description = descriptionLines.join(' ').trim();
    if (!description || description.length < 3) continue;

    items.push({
      description,
      amount: finalAmount,
      upc: null,
      sku: null,
      brand: null,
      product_size: null,
      pack_size: qtyData.quantity > 1 ? String(qtyData.quantity) : null,
      unit: null,
    });

    index += 1;
  }

  return items;
}

function extractFallbackItemsFromEmailBody(emailBody = '') {
  const structured = cleanStructuredText(redactSensitiveText(emailBody));
  if (!structured) return [];

  const allLines = structured
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const purchasedSectionItems = extractItemsPurchasedSectionItems(allLines);
  if (purchasedSectionItems.length >= 2) return purchasedSectionItems;

  let lines = allLines;
  const itemSectionIndex = allLines.findIndex((line) => /^item description$/i.test(line));
  if (itemSectionIndex >= 0) {
    lines = allLines.slice(itemSectionIndex + 1);
  }

  const stopIndex = lines.findIndex((line) => /^(subtotal|total|grand total|order total|estimated total)$/i.test(line));
  if (stopIndex > 0) {
    lines = lines.slice(0, stopIndex);
  }

  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isLikelyProductAnchor(line)) continue;

    let priceIndex = -1;
    for (let offset = 0; offset <= 5; offset += 1) {
      const candidate = lines[index + offset];
      if (!candidate) break;
      if (isSummaryLikeLine(candidate) && !isPriceBearingLine(candidate)) break;
      if (isPriceBearingLine(candidate) || isMoneyOnlyLine(candidate)) {
        priceIndex = index + offset;
        break;
      }
    }
    if (priceIndex === -1) continue;

    const block = lines.slice(index, priceIndex + 1);
    const price = parsePriceValue(lines[priceIndex]);
    if (!Number.isFinite(price) || price <= 0) continue;

    const textLines = block.filter((entry) =>
      !isPriceBearingLine(entry)
      && !isQuantityLine(entry)
      && !isSkuLikeLine(entry)
    );

    if (!textLines.length) continue;

    const brand = textLines.find((entry, entryIndex) => entryIndex > 0 && looksLikeBrandLine(entry)) || null;
    const descriptionLines = textLines.filter((entry) => entry !== brand);
    const description = descriptionLines.slice(0, 2).join(' ').trim();
    if (!description) continue;

    const sku = block.find((entry) => isSkuLikeLine(entry)) || null;
    const quantityLine = block.find((entry) => isQuantityLine(entry)) || null;
    const packSizeMatch = quantityLine ? quantityLine.match(/x\s*(\d+)/i) : null;

    items.push({
      description,
      amount: price,
      upc: null,
      sku,
      brand,
      product_size: null,
      pack_size: packSizeMatch?.[1] || null,
      unit: null,
    });

    index = priceIndex;
    if (items.length >= 30) break;
  }

  return items;
}

function summarizeStructuredItemBlock(emailBody = '') {
  const structured = cleanStructuredText(redactSensitiveText(emailBody));
  if (!structured) {
    return {
      level: 'none',
      deterministic_item_count: 0,
      has_anchor_label: false,
      sku_line_count: 0,
      quantity_line_count: 0,
    };
  }

  const lines = structured
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const deterministicItems = extractFallbackItemsFromEmailBody(emailBody);
  const hasAnchorLabel = lines.some((line) => /^(item description|items|order items|line items)$/i.test(line));
  const skuLineCount = lines.filter((line) => isSkuLikeLine(line)).length;
  const quantityLineCount = lines.filter((line) => isQuantityLine(line)).length;

  let level = 'none';
  if (deterministicItems.length >= 2) {
    if (
      hasAnchorLabel
      || skuLineCount >= deterministicItems.length
      || quantityLineCount >= deterministicItems.length
    ) {
      level = 'strong';
    } else {
      level = 'present';
    }
  }

  return {
    level,
    deterministic_item_count: deterministicItems.length,
    has_anchor_label: hasAnchorLabel,
    sku_line_count: skuLineCount,
    quantity_line_count: quantityLineCount,
  };
}

function shouldUseFallbackItems(parsed = {}, fallbackItems = []) {
  if (!Array.isArray(fallbackItems) || fallbackItems.length === 0) return false;
  const parsedItems = Array.isArray(parsed?.items) ? parsed.items : [];
  if (!parsedItems.length) return true;

  const parsedProductCount = parsedItems.filter((item) => classifyExpenseItemType(item?.description) === 'product').length;
  const fallbackProductCount = fallbackItems.filter((item) => classifyExpenseItemType(item?.description) === 'product').length;
  const parsedSummaryOrFeeCount = parsedItems.filter((item) => {
    const type = classifyExpenseItemType(item?.description);
    return type === 'summary' || type === 'fee' || type === 'discount';
  }).length;
  const parsedProductAmount = parsedItems
    .filter((item) => classifyExpenseItemType(item?.description) === 'product')
    .reduce((sum, item) => sum + Math.abs(Number(item?.amount || 0)), 0);
  const parsedTotalAmount = Math.abs(Number(parsed?.amount || 0));
  const fallbackDescriptions = new Set(
    fallbackItems
      .map((item) => `${item?.description || ''}`.trim().toLowerCase())
      .filter(Boolean)
  );
  const parsedDescriptions = new Set(
    parsedItems
      .map((item) => `${item?.description || ''}`.trim().toLowerCase())
      .filter(Boolean)
  );
  const overlappingDescriptions = [...parsedDescriptions].filter((description) => fallbackDescriptions.has(description)).length;

  if (parsedProductCount === 0 && fallbackProductCount > 0) return true;
  if (parsedProductCount < fallbackProductCount / 2 && fallbackProductCount >= 2) return true;
  if (fallbackProductCount >= 3 && parsedProductCount < fallbackProductCount) return true;
  if (fallbackProductCount >= 2 && parsedSummaryOrFeeCount >= parsedItems.length && parsedProductCount < fallbackProductCount) return true;
  if (parsedTotalAmount > 0 && parsedProductAmount > parsedTotalAmount * 2 && fallbackProductCount > 0) return true;
  if (fallbackProductCount >= 3 && overlappingDescriptions === 0) return true;
  return false;
}

function sanitizeParsedItems(items = []) {
  if (!Array.isArray(items)) return null;

  const sanitized = items
    .map((item) => ({
      ...item,
      description: `${item?.description || ''}`.trim(),
    }))
    .filter((item) => item.description)
    .filter((item) => !isClearlyNonItemLine(item.description));

  return sanitized.length > 0 ? sanitized : null;
}

function normalizeParsedPaymentFields(parsed = {}) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const paymentMethod = ['cash', 'credit', 'debit'].includes(parsed.payment_method) ? parsed.payment_method : null;
  const cardLabel = typeof parsed.card_label === 'string' && parsed.card_label.trim() ? parsed.card_label.trim() : null;
  const rawLast4 = typeof parsed.card_last4 === 'string' ? parsed.card_last4 : parsed.card_last4 != null ? String(parsed.card_last4) : '';
  const cardLast4 = /^\d{4}$/.test(rawLast4.trim()) ? rawLast4.trim() : null;
  return {
    ...parsed,
    payment_method: paymentMethod,
    card_label: cardLabel,
    card_last4: cardLast4,
  };
}

function shouldOverrideParsedAmount(parsed = {}, deterministicTotalAmount = null, discountLikeAmounts = []) {
  if (!Number.isFinite(Number(deterministicTotalAmount)) || Number(deterministicTotalAmount) === 0) return false;

  const parsedAmount = Number(parsed?.amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount === 0) return true;

  const parsedAbs = Math.abs(parsedAmount);
  const totalAbs = Math.abs(Number(deterministicTotalAmount));
  if (Math.abs(parsedAbs - totalAbs) < 0.01) return false;

  const rawLast4 = typeof parsed?.card_last4 === 'string'
    ? parsed.card_last4
    : parsed?.card_last4 != null
      ? String(parsed.card_last4)
      : '';
  const cardLast4 = /^\d{4}$/.test(rawLast4.trim()) ? Number(rawLast4.trim()) : null;

  if (cardLast4 && Math.abs(parsedAbs - cardLast4) < 0.01) return true;
  if (Array.isArray(discountLikeAmounts) && discountLikeAmounts.some((amount) => Math.abs(parsedAbs - Math.abs(Number(amount || 0))) < 0.01)) {
    return true;
  }
  if (totalAbs > 0 && parsedAbs > totalAbs * 10) return true;
  if (totalAbs > 0 && parsedAbs < totalAbs * 0.5) return true;

  return false;
}

async function classifyEmailExpense(emailBody, subject, fromAddress, todayDate, snippet = '') {
  if (!emailBody || typeof emailBody !== 'string' || emailBody.trim().length === 0) {
    throw new Error('emailBody is required');
  }
  if (!todayDate || !/^\d{4}-\d{2}-\d{2}$/.test(todayDate)) {
    throw new Error('todayDate must be a valid ISO date string (YYYY-MM-DD)');
  }

  const heuristic = heuristicDisposition(subject, fromAddress, emailBody);
  if (heuristic) {
    return { disposition: heuristic, merchant: null, reason: 'heuristic_skip' };
  }

  const { classifierText } = selectRelevantEmailText(emailBody, snippet);
  const text = await complete({
    system: CLASSIFIER_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Subject: ${subject}\nFrom: ${fromAddress}\nToday: ${todayDate}\n\n${classifierText}`,
    }],
    maxTokens: 120,
  });

  const parsed = parseJsonResponse(text);
  if (!parsed?.disposition) return { disposition: 'uncertain', merchant: null, reason: 'classifier_parse_failed' };
  return {
    disposition: parsed.disposition,
    merchant: parsed.merchant || null,
    reason: parsed.reason || null,
  };
}

async function parseEmailExpense(emailBody, subject, fromAddress, todayDate, snippet = '') {
  if (!emailBody || typeof emailBody !== 'string' || emailBody.trim().length === 0) {
    throw new Error('emailBody is required');
  }
  if (!todayDate || !/^\d{4}-\d{2}-\d{2}$/.test(todayDate)) {
    throw new Error('todayDate must be a valid ISO date string (YYYY-MM-DD)');
  }

  const { extractionText } = selectRelevantEmailText(emailBody, snippet);

  const text = await complete({
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Subject: ${subject}\nFrom: ${fromAddress}\nToday: ${todayDate}\n\n${extractionText}`,
    }],
  });

  const parsed = normalizeParsedPaymentFields(parseJsonResponse(text));
  if (!parsed || typeof parsed !== 'object') return parsed;
  const deterministicTotalAmount = extractDeterministicTotalAmount(emailBody);
  const discountLikeAmounts = extractDiscountLikeAmounts(emailBody);
  const sanitizedParsed = {
    ...parsed,
    amount: shouldOverrideParsedAmount(parsed, deterministicTotalAmount, discountLikeAmounts)
      ? deterministicTotalAmount
      : parsed.amount,
    items: sanitizeParsedItems(parsed.items),
  };

  const fallbackItems = extractFallbackItemsFromEmailBody(emailBody);
  if (shouldUseFallbackItems(sanitizedParsed, fallbackItems)) {
    return {
      ...sanitizedParsed,
      items: fallbackItems,
    };
  }

  return sanitizedParsed;
}

function clampExpenseDate(candidateDate, maxDate) {
  if (!candidateDate || !/^\d{4}-\d{2}-\d{2}$/.test(candidateDate)) return maxDate;
  if (!maxDate || !/^\d{4}-\d{2}-\d{2}$/.test(maxDate)) return candidateDate;
  return candidateDate > maxDate ? maxDate : candidateDate;
}

module.exports = {
  parseEmailExpense,
  classifyEmailExpense,
  selectRelevantEmailText,
  extractFallbackItemsFromEmailBody,
  summarizeStructuredItemBlock,
  heuristicDisposition,
  analyzeEmailSignals,
  classifyEmailModality,
  extractEmailLocationCandidate,
  clampExpenseDate,
};
