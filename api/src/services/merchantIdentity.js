const db = require('../db');

const BOILERPLATE_MARKERS = [
  /\blet us know\b/i,
  /\btell us (?:about|how|what)\b/i,
  /\bhow (?:was|did) your (?:visit|experience|order)\b/i,
  /\bshare your feedback\b/i,
  /\brate your (?:visit|experience|order)\b/i,
  /\btake (?:our|a) survey\b/i,
  /\bscan (?:the )?qr code\b/i,
  /\bquestions or comments\b/i,
  /\bjoin (?:our|the) rewards\b/i,
  /\bfollow us\b/i,
  /\bvisit (?:us|our website)\b/i,
  /\bthanks? for (?:shopping|visiting|your purchase)\b/i,
  /\bwww\.[a-z0-9-]+\./i,
];

const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company',
]);

function collapseWhitespace(value) {
  return `${value || ''}`.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function cutBoilerplateTail(value) {
  let cutAt = value.length;
  for (const marker of BOILERPLATE_MARKERS) {
    const match = marker.exec(value);
    if (match) cutAt = Math.min(cutAt, match.index);
  }
  return value.slice(0, cutAt).trim();
}

function titleCaseMerchant(value) {
  if (!value || (/[a-z]/.test(value) && /[A-Z]/.test(value))) return value;
  return value.toLowerCase().replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function cleanMerchantDisplayName(value) {
  const compact = collapseWhitespace(value)
    .replace(/^[#*\-:|\s]+/, '')
    .replace(/[|•]+/g, ' ');
  if (!compact) return null;

  const withoutTail = cutBoilerplateTail(compact)
    .replace(/\b(?:receipt|customer copy|merchant copy)\s*$/i, '')
    .replace(/[\s,.;:|\-]+$/, '')
    .trim();
  if (!withoutTail) return null;
  return titleCaseMerchant(withoutTail).slice(0, 160);
}

function canonicalMerchantKey(value) {
  const cleaned = cleanMerchantDisplayName(value);
  if (!cleaned) return '';
  const tokens = cleaned
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join('');
}

function choosePreferredDisplay(rows = [], fallback = null) {
  const ranked = new Map();
  for (const row of rows) {
    const name = cleanMerchantDisplayName(row?.merchant);
    if (!name) continue;
    const key = name.toLowerCase();
    const current = ranked.get(key) || { name, count: 0, latest: '' };
    current.count += Number(row?.usage_count || 1);
    current.latest = `${row?.last_seen_at || current.latest || ''}`;
    ranked.set(key, current);
  }
  return [...ranked.values()].sort((a, b) => (
    b.count - a.count || `${b.latest}`.localeCompare(`${a.latest}`) || a.name.localeCompare(b.name)
  ))[0]?.name || fallback;
}

async function canonicalizeMerchantForHousehold({ householdId, merchant, queryable = db } = {}) {
  const rawMerchant = collapseWhitespace(merchant) || null;
  const cleanedMerchant = cleanMerchantDisplayName(rawMerchant);
  const merchantKey = canonicalMerchantKey(cleanedMerchant);
  if (!cleanedMerchant || !merchantKey || !householdId) {
    return {
      raw_merchant: rawMerchant,
      merchant: cleanedMerchant,
      merchant_key: merchantKey || null,
      confidence: cleanedMerchant ? 'medium' : 'low',
      reason: rawMerchant && cleanedMerchant !== rawMerchant ? 'boilerplate_removed' : 'normalized_only',
    };
  }

  try {
    const result = await queryable.query(
      `SELECT merchant, COUNT(*)::int AS usage_count, MAX(date) AS last_seen_at
       FROM expenses
       WHERE household_id = $1
         AND status IN ('confirmed', 'pending')
         AND date >= CURRENT_DATE - INTERVAL '365 days'
         AND REGEXP_REPLACE(LOWER(COALESCE(merchant, '')), '[^a-z0-9]+', '', 'g') = $2
       GROUP BY merchant
       ORDER BY usage_count DESC, last_seen_at DESC
       LIMIT 12`,
      [householdId, merchantKey]
    );
    const knownDisplay = choosePreferredDisplay(result.rows, cleanedMerchant);
    return {
      raw_merchant: rawMerchant,
      merchant: knownDisplay,
      merchant_key: merchantKey,
      confidence: result.rows.length ? 'high' : (cleanedMerchant !== rawMerchant ? 'medium' : 'high'),
      reason: result.rows.length
        ? 'household_history'
        : (cleanedMerchant !== rawMerchant ? 'boilerplate_removed' : 'normalized_only'),
    };
  } catch (error) {
    console.error('[merchantIdentity] history lookup failed (non-fatal):', error?.message || error);
    return {
      raw_merchant: rawMerchant,
      merchant: cleanedMerchant,
      merchant_key: merchantKey,
      confidence: cleanedMerchant !== rawMerchant ? 'medium' : 'high',
      reason: cleanedMerchant !== rawMerchant ? 'boilerplate_removed' : 'normalized_only',
    };
  }
}

function mergeMerchantRows(rows = [], { amountField = 'spent', countField = null } = {}) {
  const merged = new Map();
  for (const row of rows || []) {
    const display = cleanMerchantDisplayName(row?.merchant_name || row?.merchant || row?.merchant_key) || 'Unknown';
    const key = canonicalMerchantKey(display) || 'unknown';
    const current = merged.get(key) || {
      ...row,
      merchant_key: key,
      merchant_name: display,
      [amountField]: 0,
      ...(countField ? { [countField]: 0 } : {}),
    };
    if (display.length < `${current.merchant_name || ''}`.length) {
      current.merchant_name = display;
    }
    current[amountField] += Number(row?.[amountField] || 0);
    if (countField) current[countField] += Number(row?.[countField] || 0);
    merged.set(key, current);
  }
  return [...merged.values()].map((row) => ({
    ...row,
    [amountField]: Number(Number(row[amountField] || 0).toFixed(2)),
  }));
}

module.exports = {
  canonicalMerchantKey,
  canonicalizeMerchantForHousehold,
  cleanMerchantDisplayName,
  mergeMerchantRows,
};
