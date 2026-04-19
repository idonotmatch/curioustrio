function normalizeMerchant(value) {
  return `${value || ''}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isUnknownMerchantValue(value) {
  const normalized = normalizeMerchant(value);
  return !normalized || normalized === 'unknown' || normalized === 'unknownmerchant';
}

function timeValue(value) {
  const raw = `${value || ''}`.trim();
  if (!raw) return 0;
  const parsed = new Date(raw.includes('T') ? raw : `${raw.slice(0, 10)}T12:00:00`);
  const stamp = parsed.getTime();
  return Number.isNaN(stamp) ? 0 : stamp;
}

function merchantMatchScore(expense, metadata = {}) {
  const merchantKey = normalizeMerchant(metadata.merchant_key || metadata.merchant_name);
  const merchant = normalizeMerchant(expense?.merchant);
  if (!merchantKey || !merchant || isUnknownMerchantValue(expense?.merchant)) return -Infinity;
  if (merchant === merchantKey) return 120;
  if (merchant.startsWith(merchantKey) || merchantKey.startsWith(merchant)) return 100;
  if (merchant.includes(merchantKey) || merchantKey.includes(merchant)) return 80;
  return -Infinity;
}

function categoryMatchScore(expense, metadata = {}) {
  const categoryKey = `${metadata.category_key || ''}`.trim();
  if (!categoryKey) return -Infinity;
  if (`${expense?.category_id || ''}` !== categoryKey) return -Infinity;

  let score = 90;
  if (metadata.category_name && `${expense?.category_name || ''}` === `${metadata.category_name}`) {
    score += 10;
  }
  return score;
}

function cleanupMatchScore(expense) {
  const categoryId = `${expense?.category_id || ''}`.trim();
  if (!categoryId || categoryId === 'uncategorized') return 70;
  return -Infinity;
}

function recencyScore(expense, metadata = {}) {
  const expenseTime = timeValue(expense?.date);
  if (!expenseTime) return 0;
  const referenceTime = timeValue(metadata.latest_date || metadata.date);
  if (!referenceTime) return expenseTime / 1e12;
  const daysApart = Math.abs(referenceTime - expenseTime) / (24 * 60 * 60 * 1000);
  return Math.max(0, 20 - Math.min(daysApart, 20));
}

function amountScore(expense) {
  const amount = Math.abs(Number(expense?.amount || 0));
  if (!amount) return 0;
  if (amount >= 200) return 12;
  if (amount >= 100) return 9;
  if (amount >= 50) return 6;
  if (amount >= 20) return 3;
  return 1;
}

function stableTieBreaker(a, b) {
  return timeValue(b?.date) - timeValue(a?.date);
}

function scoreEvidenceRow(expense, mode, metadata = {}) {
  let baseScore = -Infinity;
  if (mode === 'merchant') baseScore = merchantMatchScore(expense, metadata);
  else if (mode === 'category') baseScore = categoryMatchScore(expense, metadata);
  else if (mode === 'cleanup') baseScore = cleanupMatchScore(expense);
  else if (mode === 'largest_expense') baseScore = expense?.id ? 100 : -Infinity;

  if (!Number.isFinite(baseScore)) return -Infinity;

  let score = baseScore + recencyScore(expense, metadata) + amountScore(expense);

  if (mode === 'merchant' && metadata.category_name && `${expense?.category_name || ''}` === `${metadata.category_name}`) {
    score += 6;
  }

  return score;
}

export function selectInsightEvidence(rows = [], mode, metadata = {}, limit = 5) {
  if (!Array.isArray(rows) || !mode) return [];

  return rows
    .map((expense, index) => ({
      expense,
      index,
      score: scoreEvidenceRow(expense, mode, metadata),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return stableTieBreaker(a.expense, b.expense) || a.index - b.index;
    })
    .slice(0, limit)
    .map((entry) => entry.expense);
}

export { normalizeMerchant, isUnknownMerchantValue };
