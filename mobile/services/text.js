function decodeHtmlEntities(value = '') {
  return `${value || ''}`
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+)(?:;|(?!\d))/g, (_match, code) => {
      const point = Number(code);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : '';
    })
    .replace(/&#x([0-9a-f]+)(?:;|(?![0-9a-f]))/gi, (_match, code) => {
      const point = Number.parseInt(code, 16);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : '';
    });
}

const MOJIBAKE_REPLACEMENTS = [
  [/\u00e2\u20ac\u2122/g, "'"],
  [/\u00e2\u20ac\u0153/g, '"'],
  [/\u00e2\u20ac\u009d/g, '"'],
  [/\u00e2\u20ac\u201c/g, '-'],
  [/\u00e2\u20ac\u201d/g, '-'],
  [/\u00e2\u20ac\u00a6/g, '...'],
  [/\u00e2\u20ac\u00a2/g, ' / '],
  [/\u00c2\u00b7/g, ' / '],
  [/\u00c2\u00a0/g, ' '],
];

function normalizeDisplayText(value = '') {
  let normalized = decodeHtmlEntities(decodeHtmlEntities(value));
  for (const [pattern, replacement] of MOJIBAKE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022|\u00b7/g, ' / ')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|\n)\s*[*-]\s+(?=\S)/g, '$1')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s*\/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DISPLAY_METADATA_KEYS = /(^|_)(name|label|headline|detail|reason|copy|message|description)$/i;

function normalizeDisplayMetadata(value, key = '') {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeDisplayMetadata(entry, key));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeDisplayMetadata(entryValue, entryKey),
      ])
    );
  }
  if (typeof value === 'string' && (DISPLAY_METADATA_KEYS.test(key) || key === 'merchant')) {
    return normalizeDisplayText(value);
  }
  return value;
}

function normalizeInsightForDisplay(insight = {}) {
  if (!insight || typeof insight !== 'object') return insight;
  const action = insight.action && typeof insight.action === 'object'
    ? {
        ...insight.action,
        title: normalizeDisplayText(insight.action.title),
        cta: normalizeDisplayText(insight.action.cta),
        reason: normalizeDisplayText(insight.action.reason),
        body: normalizeDisplayText(insight.action.body),
      }
    : insight.action;
  return {
    ...insight,
    title: normalizeDisplayText(insight.title),
    body: normalizeDisplayText(insight.body),
    metadata: normalizeDisplayMetadata(insight.metadata || {}),
    forecast: normalizeDisplayMetadata(insight.forecast || {}),
    action,
  };
}

module.exports = {
  decodeHtmlEntities,
  normalizeDisplayText,
  normalizeInsightForDisplay,
};
