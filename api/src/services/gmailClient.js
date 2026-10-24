const crypto = require('crypto');
const { google } = require('googleapis');
const fetch = require('node-fetch');
const { PDFParse } = require('pdf-parse');
const OAuthToken = require('../models/oauthToken');
const db = require('../db');
const { decodeHtmlEntities } = require('../utils/htmlEntities');

const GOOGLE_REQUEST_TIMEOUT_MS = Math.max(
  3000,
  Math.min(Number(process.env.GOOGLE_REQUEST_TIMEOUT_MS) || 15000, 60000)
);
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_PDF_ATTACHMENTS = 2;
const MAX_ATTACHMENT_TEXT_CHARS = 24000;

const GMAIL_SEARCH_QUERY = [
  'newer_than:30d',
  '-category:promotions',
  '-category:social',
  '(',
  'subject:(receipt OR order OR "order:" OR confirmation OR purchase OR invoice OR payment OR refund OR return OR renewal OR booking OR subscription OR trip)',
  'OR',
  '"order total"',
  'OR',
  '"total charged"',
  'OR',
  '"payment received"',
  'OR',
  '"you paid"',
  'OR',
  '"receipt for your payment"',
  'OR',
  '"ride receipt"',
  'OR',
  '"your ride"',
  'OR',
  '"thanks for riding"',
  'OR',
  'from:(orders@amazon.com)',
  'OR',
  'from:(auto-confirm@amazon.com)',
  'OR',
  '(from:(amazon.com) subject:"ORDER:")',
  'OR',
  'from:(uber.com)',
  'OR',
  'from:(lyftmail.com)',
  'OR',
  'from:(venmo.com)',
  ')',
].join(' ');

function createOAuth2Client() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.transporter.defaults = {
    ...client.transporter.defaults,
    timeout: GOOGLE_REQUEST_TIMEOUT_MS,
  };
  return client;
}

async function getAuthUrl(userId, { loginHint = null } = {}) {
  const stateToken = crypto.randomUUID();
  await db.query(
    `INSERT INTO gmail_oauth_states (token, user_id) VALUES ($1, $2)`, [stateToken, userId]
  );
  const client = createOAuth2Client();
  const authParams = {
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    prompt: 'consent',
    include_granted_scopes: true,
    state: stateToken,
  };
  if (loginHint) {
    authParams.login_hint = loginHint;
  }
  return client.generateAuthUrl(authParams);
}

async function exchangeCode(code) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope: tokens.scope,
  };
}

async function getAuthenticatedClient(userId) {
  const tokenRow = await OAuthToken.findCredentialsByUserId(userId);
  if (!tokenRow) throw new Error('Gmail not connected for this user');

  const client = createOAuth2Client();
  client.setCredentials({
    refresh_token: tokenRow.refresh_token,
  });

  // Always refresh — access_token is never persisted, so always fetch a fresh one
  const { credentials } = await client.refreshAccessToken();
  await OAuthToken.upsert({
    userId,
    accessToken: null,       // do not persist
    refreshToken: credentials.refresh_token || tokenRow.refresh_token,
    expiresAt: null,
    scope: tokenRow.scope,
  });
  client.setCredentials(credentials); // in-memory only, valid for this request

  return client;
}

async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) return false;
  const response = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `token=${encodeURIComponent(refreshToken)}`,
    timeout: GOOGLE_REQUEST_TIMEOUT_MS,
  });
  return response.ok;
}

async function disconnectGmailConnection(userId) {
  const tokenRow = await OAuthToken.findCredentialsByUserId(userId);
  if (!tokenRow) {
    await db.query(`DELETE FROM gmail_oauth_states WHERE user_id = $1`, [userId]);
    return { disconnected: true, revoked: false, had_token: false };
  }

  let revoked = false;
  try {
    revoked = await revokeRefreshToken(tokenRow.refresh_token);
  } catch {
    revoked = false;
  }

  await OAuthToken.deleteByUserId(userId);
  await db.query(`DELETE FROM gmail_oauth_states WHERE user_id = $1`, [userId]);
  return { disconnected: true, revoked, had_token: true };
}

async function listRecentMessages(userId, options = 100) {
  const config = typeof options === 'number'
    ? { maxResults: options }
    : (options || {});
  const maxResults = Math.max(1, Math.min(Number(config.maxResults) || 100, 100));
  const query = `${config.query || GMAIL_SEARCH_QUERY}`.trim() || GMAIL_SEARCH_QUERY;
  const gmail = config.gmailClient || google.gmail({
    version: 'v1',
    auth: await getAuthenticatedClient(userId),
  });
  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: query,
  }, {
    timeout: GOOGLE_REQUEST_TIMEOUT_MS,
  });
  return response.data.messages || [];
}

async function getProfileHistoryId(userId, { gmailClient = null } = {}) {
  const gmail = gmailClient || google.gmail({
    version: 'v1',
    auth: await getAuthenticatedClient(userId),
  });
  const response = await gmail.users.getProfile({ userId: 'me' }, {
    timeout: GOOGLE_REQUEST_TIMEOUT_MS,
  });
  return `${response.data.historyId || ''}`.trim() || null;
}

async function listHistoryMessages(userId, startHistoryId, {
  gmailClient = null,
  maxPages = 10,
  maxMessages = 500,
} = {}) {
  const cleanStartHistoryId = `${startHistoryId || ''}`.trim();
  if (!cleanStartHistoryId) throw new Error('Gmail history cursor is required');
  const gmail = gmailClient || google.gmail({
    version: 'v1',
    auth: await getAuthenticatedClient(userId),
  });
  const seen = new Set();
  const messages = [];
  let pageToken = null;
  let historyId = cleanStartHistoryId;
  let pageCount = 0;

  do {
    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: cleanStartHistoryId,
      historyTypes: ['messageAdded'],
      maxResults: 500,
      ...(pageToken ? { pageToken } : {}),
    }, {
      timeout: GOOGLE_REQUEST_TIMEOUT_MS,
    });
    pageCount += 1;
    historyId = `${response.data.historyId || historyId}`.trim();

    for (const entry of response.data.history || []) {
      for (const added of entry.messagesAdded || []) {
        const message = added?.message;
        if (!message?.id || seen.has(message.id)) continue;
        seen.add(message.id);
        messages.push({ id: message.id, threadId: message.threadId || null });
        if (messages.length > maxMessages) {
          const error = new Error('Gmail history backlog exceeds the safe incremental limit');
          error.code = 'gmail_history_backlog_too_large';
          throw error;
        }
      }
    }

    pageToken = response.data.nextPageToken || null;
    if (pageToken && pageCount >= maxPages) {
      const error = new Error('Gmail history pagination exceeds the safe incremental limit');
      error.code = 'gmail_history_backlog_too_large';
      throw error;
    }
  } while (pageToken);

  return { messages, historyId, pageCount };
}

function htmlToReadableText(html = '') {
  if (!html) return '';
  return decodeHtmlEntities(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n')
    .replace(/<\s*\/div\s*>/gi, '\n')
    .replace(/<\s*\/tr\s*>/gi, '\n')
    .replace(/<\s*(td|th)\b[^>]*>/gi, ' ')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function decodeGmailData(data = '') {
  const normalized = `${data || ''}`.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  return Buffer.from(padding ? normalized.padEnd(normalized.length + (4 - padding), '=') : normalized, 'base64');
}

function compactStructuredValue(value) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number') {
    return `${value}`.replace(/\s+/g, ' ').trim() || null;
  }
  if (typeof value === 'object') {
    return compactStructuredValue(value.name || value.value || value.identifier || value['@id']);
  }
  return null;
}

function collectJsonLdNodes(value, nodes = []) {
  if (Array.isArray(value)) {
    value.forEach(item => collectJsonLdNodes(item, nodes));
    return nodes;
  }
  if (!value || typeof value !== 'object') return nodes;
  nodes.push(value);
  if (Array.isArray(value['@graph'])) collectJsonLdNodes(value['@graph'], nodes);
  return nodes;
}

function normalizeJsonLdItems(value) {
  const items = Array.isArray(value) ? value : (value ? [value] : []);
  return items.map((entry) => {
    const item = entry?.itemOffered || entry?.orderedItem || entry?.item || entry;
    const offer = entry?.acceptedOffer || entry?.offers || entry;
    const description = compactStructuredValue(item?.name || entry?.name || item?.description);
    const quantity = compactStructuredValue(entry?.orderQuantity || entry?.quantity || item?.quantity);
    const unitPrice = compactStructuredValue(offer?.price || entry?.unitPrice || item?.price);
    const amount = compactStructuredValue(entry?.price || entry?.totalPrice || offer?.price);
    if (!description) return null;
    return { description, quantity, unitPrice, amount };
  }).filter(Boolean).slice(0, 40);
}

function extractStructuredHtmlEvidence(html = '') {
  if (!html) return '';
  const lines = [];
  const scriptPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1]).trim());
      for (const node of collectJsonLdNodes(parsed)) {
        const type = Array.isArray(node['@type']) ? node['@type'].join(' ') : `${node['@type'] || ''}`;
        if (!/(order|invoice|receipt|payment|reservation)/i.test(type)) continue;

        const orderId = compactStructuredValue(
          node.orderNumber || node.confirmationNumber || node.invoiceNumber || node.identifier
        );
        const merchant = compactStructuredValue(node.seller || node.merchant || node.provider || node.broker);
        const total = compactStructuredValue(
          node.totalPrice || node.price || node.paymentDue?.price || node.paymentDue || node.totalPaymentDue?.price || node.totalPaymentDue
        );
        const currency = compactStructuredValue(
          node.priceCurrency || node.totalPriceCurrency || node.paymentDue?.priceCurrency
        );
        if (orderId) lines.push(`Order ID: ${orderId}`);
        if (merchant) lines.push(`Merchant: ${merchant}`);
        if (total) lines.push(`Order total: ${currency ? `${currency} ` : ''}${total}`);

        const items = normalizeJsonLdItems(
          node.orderedItem || node.acceptedOffer || node.itemListElement || node.referencesOrder?.orderedItem
        );
        if (items.length) lines.push('Items purchased:');
        for (const item of items) {
          lines.push(item.description);
          if (item.quantity) lines.push(`x ${item.quantity}`);
          if (item.amount) lines.push(`${currency ? `${currency} ` : ''}${item.amount}`);
          else if (item.unitPrice) lines.push(`Unit price: ${currency ? `${currency} ` : ''}${item.unitPrice}`);
        }
      }
    } catch {
      // Invalid marketing JSON-LD should not block a receipt import.
    }
  }

  const unique = [...new Set(lines.map(line => line.trim()).filter(Boolean))];
  return unique.length ? `[Structured receipt data]\n${unique.join('\n')}` : '';
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText({ first: 12 });
    return `${result?.text || ''}`.trim();
  } finally {
    await parser.destroy();
  }
}

function appendEvidence(body, evidence) {
  const cleanBody = `${body || ''}`.trim();
  const cleanEvidence = `${evidence || ''}`.trim();
  if (!cleanEvidence) return cleanBody;
  if (!cleanBody) return cleanEvidence;
  return `${cleanBody}\n\n${cleanEvidence}`;
}

function countLineMatches(text = '', pattern) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => pattern.test(line)).length;
}

function cssNoisePenalty(text = '') {
  const normalized = `${text || ''}`.trim();
  if (!normalized) return 0;

  const commentMatches = normalized.match(/\/\*[\s\S]*?\*\//g) || [];
  const propertyMatches = normalized.match(/\b(?:margin|padding|width|height|display|color|font|line-height|border|background|text-decoration|text-transform|opacity|cursor|direction|border-spacing|border-collapse)\s*:/gi) || [];
  const selectorMatches = normalized.match(/(?:^|\n)\s*(?:html|body|table|img|div|a|th|td|\.[A-Za-z0-9_-]+|#[A-Za-z0-9_-]+|\*\[[^\]]+\])[^a-zA-Z0-9\n]*\{/gm) || [];
  const braceCount = (normalized.match(/[{}]/g) || []).length;
  const semicolonCount = (normalized.match(/;/g) || []).length;

  const longCssSignals = [
    /\/\*\s*what it does:/i,
    /\.ExternalClass/i,
    /\[x-apple-data-detectors\]/i,
    /\.x-gmail-data-detectors/i,
    /mso-table-lspace/i,
    /-webkit-text-size-adjust/i,
  ].reduce((count, pattern) => count + (pattern.test(normalized) ? 1 : 0), 0);

  return (
    Math.min(commentMatches.length, 12) * 6
    + Math.min(propertyMatches.length, 24) * 2
    + Math.min(selectorMatches.length, 16) * 4
    + Math.min(Math.floor(braceCount / 2), 20) * 2
    + Math.min(Math.floor(semicolonCount / 4), 20) * 1
    + longCssSignals * 10
  );
}

function bodyRichnessScore(text = '') {
  const normalized = `${text || ''}`.trim();
  if (!normalized) return 0;

  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const moneyLines = countLineMatches(normalized, /\$\s?-?\d+(?:\.\d{2})?/);
  const quantityLines = countLineMatches(normalized, /^(?:qty|quantity)?\s*x?\s*\d+\b/i);
  const skuLines = countLineMatches(normalized, /^[A-Z0-9-]{5,}$/);
  const summaryLines = countLineMatches(normalized, /^(subtotal|total|order total|amount paid|amount charged|grand total|estimated total|shipping|tax)/i);
  const productLikeLines = Math.max(countLineMatches(normalized, /[a-z]/i) - summaryLines, 0);
  const cssPenalty = cssNoisePenalty(normalized);

  return (
    Math.min(lines.length, 60) * 1
    + Math.min(productLikeLines, 24) * 2
    + Math.min(moneyLines, 16) * 3
    + Math.min(quantityLines, 12) * 3
    + Math.min(skuLines, 12) * 4
    - Math.min(summaryLines, 12) * 1
    - cssPenalty
  );
}

function chooseBestMessageBody(plainText = '', htmlText = '', snippet = '') {
  const normalizedPlain = `${plainText || ''}`.trim();
  const normalizedHtml = `${htmlText || ''}`.trim();
  if (!normalizedPlain) return normalizedHtml || snippet || '';
  if (!normalizedHtml) return normalizedPlain || snippet || '';

  const plainScore = bodyRichnessScore(normalizedPlain);
  const htmlScore = bodyRichnessScore(normalizedHtml);

  if (htmlScore >= plainScore + 8) {
    return normalizedHtml;
  }
  return normalizedPlain;
}

async function getMessage(userId, messageId, {
  gmailClient = null,
  pdfTextExtractor = extractPdfText,
} = {}) {
  const gmail = gmailClient || google.gmail({
    version: 'v1',
    auth: await getAuthenticatedClient(userId),
  });
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  }, {
    timeout: GOOGLE_REQUEST_TIMEOUT_MS,
  });

  const payload = response.data.payload;
  const snippet = decodeHtmlEntities(response.data.snippet || '');
  const receivedAt = response.data.internalDate
    ? new Date(Number(response.data.internalDate)).toISOString().split('T')[0]
    : null;
  const headers = payload?.headers || [];
  const subject = decodeHtmlEntities(headers.find(h => h.name === 'Subject')?.value || '');
  const from = decodeHtmlEntities(headers.find(h => h.name === 'From')?.value || '');

  const attachmentParts = [];
  let plainBody = '';
  let htmlBody = '';
  function extractBody(part) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      plainBody += decodeGmailData(part.body.data).toString('utf-8');
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      htmlBody += decodeGmailData(part.body.data).toString('utf-8');
    } else if (part.body?.attachmentId) {
      attachmentParts.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename || '',
        mimeType: `${part.mimeType || ''}`.toLowerCase(),
        size: Number(part.body.size || 0),
      });
    }
    if (part.parts) part.parts.forEach(extractBody);
  }
  if (payload) extractBody(payload);

  let attachmentText = '';
  let attachmentTextCount = 0;
  let pdfCount = 0;
  for (const part of attachmentParts) {
    const isText = part.mimeType === 'text/plain' || part.mimeType === 'text/html';
    const isPdf = part.mimeType === 'application/pdf' || /\.pdf$/i.test(part.filename);
    if ((!isText && !isPdf) || part.size > MAX_ATTACHMENT_BYTES) continue;
    if (isPdf && pdfCount >= MAX_PDF_ATTACHMENTS) continue;

    try {
      const attachment = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: part.attachmentId,
      }, {
        timeout: GOOGLE_REQUEST_TIMEOUT_MS,
      });
      const data = decodeGmailData(attachment.data?.data || '');
      if (!data.length || data.length > MAX_ATTACHMENT_BYTES) continue;
      let text = '';
      if (isPdf) {
        pdfCount += 1;
        text = await pdfTextExtractor(data);
      } else {
        text = data.toString('utf-8');
        if (part.mimeType === 'text/html') text = htmlToReadableText(text);
      }
      if (!text.trim()) continue;
      attachmentTextCount += 1;
      const label = part.filename ? `Attachment: ${part.filename}` : 'Attachment text';
      attachmentText = appendEvidence(attachmentText, `[${label}]\n${text.trim()}`);
      attachmentText = attachmentText.slice(0, MAX_ATTACHMENT_TEXT_CHARS);
      if (attachmentText.length >= MAX_ATTACHMENT_TEXT_CHARS) break;
    } catch (error) {
      console.warn('[gmail] attachment text extraction failed', {
        mime_type: part.mimeType || 'unknown',
        reason: error?.name || 'attachment_parse_failed',
      });
    }
  }

  const normalizedPlain = plainBody
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const normalizedHtml = htmlToReadableText(htmlBody);
  const structuredEvidence = extractStructuredHtmlEvidence(htmlBody);
  let body = chooseBestMessageBody(normalizedPlain, normalizedHtml, snippet);
  body = appendEvidence(body, structuredEvidence);
  body = appendEvidence(body, attachmentText);

  return {
    subject,
    from,
    snippet,
    body,
    labelIds: Array.isArray(response.data.labelIds) ? response.data.labelIds : [],
    receivedAt,
    threadId: response.data.threadId || null,
    attachmentCount: attachmentParts.length,
    attachmentTextCount,
  };
}

async function createGmailSession(userId) {
  const auth = await getAuthenticatedClient(userId);
  const gmailClient = google.gmail({ version: 'v1', auth });
  return {
    listRecentMessages: (options = 100) => listRecentMessages(userId, {
      ...(typeof options === 'number' ? { maxResults: options } : options),
      gmailClient,
    }),
    getMessage: (messageId) => getMessage(userId, messageId, { gmailClient }),
    getProfileHistoryId: () => getProfileHistoryId(userId, { gmailClient }),
    listHistoryMessages: (startHistoryId, options = {}) => listHistoryMessages(userId, startHistoryId, {
      ...options,
      gmailClient,
    }),
  };
}

module.exports = {
  GMAIL_SEARCH_QUERY,
  getAuthUrl,
  exchangeCode,
  getAuthenticatedClient,
  createGmailSession,
  disconnectGmailConnection,
  listRecentMessages,
  getProfileHistoryId,
  listHistoryMessages,
  getMessage,
  htmlToReadableText,
  chooseBestMessageBody,
  bodyRichnessScore,
  decodeGmailData,
  extractStructuredHtmlEvidence,
  extractPdfText,
};
