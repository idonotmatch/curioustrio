import { selectInsightEvidence } from './insightEvidence';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function getPastMonths() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 13; i += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(date.toISOString().slice(0, 7));
  }
  return months;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const clean = dateStr.slice(0, 10) + 'T12:00:00';
  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) return dateStr;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

export function formatRelativeTime(value) {
  if (!value) return null;
  const diffMs = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diffMs)) return null;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1m ago';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1h ago';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

export function insightEventMetadata(insight, surface = 'summary') {
  return {
    surface,
    type: insight?.type || null,
    insight_type: insight?.type || null,
    maturity: insight?.metadata?.maturity || null,
    confidence: insight?.metadata?.confidence || null,
    scope: insight?.metadata?.scope || null,
    entity_type: insight?.entity_type || null,
    entity_id: insight?.entity_id || null,
    category_key: insight?.metadata?.category_key || null,
    merchant_key: insight?.metadata?.merchant_key || null,
    continuity_key: insight?.metadata?.continuity_key || null,
    scope_relationship: insight?.metadata?.scope_relationship || null,
    consolidated_scopes: insight?.metadata?.consolidated_scopes || null,
    related_insight_ids: insight?.metadata?.related_insight_ids || null,
    next_step_type: insight?.action?.next_step_type || null,
    action_cta: insight?.action?.cta || null,
  };
}

export function buildRecurringItemPreload(insight) {
  const metadata = insight?.metadata || {};
  const merchantBreakdown = Array.isArray(metadata.merchant_breakdown) ? metadata.merchant_breakdown : [];
  const merchants = Array.isArray(metadata.merchants)
    ? metadata.merchants.filter(Boolean)
    : merchantBreakdown.map((entry) => entry?.merchant).filter(Boolean);
  const fallbackMerchant = metadata.latest_merchant || metadata.merchant || null;

  return {
    group_key: metadata.group_key || null,
    item_name: metadata.item_name || insight?.title || 'Recurring item',
    brand: metadata.brand || null,
    average_gap_days: metadata.average_gap_days ?? null,
    occurrence_count: metadata.occurrence_count ?? metadata.expense_count ?? null,
    median_amount: metadata.median_amount ?? metadata.average_amount ?? null,
    median_unit_price: metadata.median_unit_price ?? null,
    last_purchased_at: metadata.last_purchased_at || metadata.last_seen_at || null,
    next_expected_date: metadata.next_expected_date || null,
    merchants: merchants.length ? merchants : (fallbackMerchant ? [fallbackMerchant] : []),
    merchant_price_history: merchantBreakdown.map((entry) => ({
      merchant: entry?.merchant || 'Unknown merchant',
      occurrence_count: entry?.occurrence_count ?? entry?.count ?? 1,
      median_amount: entry?.median_amount ?? entry?.average_amount ?? entry?.amount ?? null,
      median_unit_price: entry?.median_unit_price ?? null,
    })),
    purchases: Array.isArray(metadata.purchases) ? metadata.purchases : [],
  };
}

export function parseScenarioInput(raw, { allowHousehold = false } = {}) {
  const trimmed = `${raw || ''}`.trim();
  if (!trimmed) return null;

  let normalized = trimmed.toLowerCase();
  normalized = normalized.replace(/^(can i afford|could i afford|check|scenario)\s+/i, '');
  let timingMode = 'now';

  if (/\b(next month|next period)\b/i.test(normalized)) {
    timingMode = 'next_period';
    normalized = normalized.replace(/\b(next month|next period)\b/gi, ' ');
  } else if (/\b(spread( it)? over (a few|few|3|three) months?|over (a few|few|3|three) months?)\b/i.test(normalized)) {
    timingMode = 'spread_3_periods';
    normalized = normalized.replace(/\b(spread( it)? over (a few|few|3|three) months?|over (a few|few|3|three) months?)\b/gi, ' ');
  }

  let scope = 'personal';
  if (allowHousehold && normalized.startsWith('household ')) {
    scope = 'household';
    normalized = normalized.slice('household '.length);
  } else if (normalized.startsWith('mine ')) {
    scope = 'personal';
    normalized = normalized.slice('mine '.length);
  }

  const amountMatch = normalized.match(/(\d+(?:\.\d{1,2})?)/);
  if (!amountMatch) return null;
  const amount = amountMatch[1];
  const amountIndex = amountMatch.index || 0;
  const before = normalized.slice(0, amountIndex).trim();
  const after = normalized.slice(amountIndex + amount.length).trim();
  const label = `${before} ${after}`.replace(/\s+/g, ' ').trim();

  return {
    amount,
    label,
    scope,
    timingMode,
  };
}

export function buildPreloadedCategoryExpenses(insight, personalExpenses = [], householdExpenses = []) {
  const categoryKey = `${insight?.metadata?.category_key || ''}`.trim();
  const month = `${insight?.metadata?.month || ''}`.trim();
  if (!categoryKey || !month) return [];

  const source = `${insight?.metadata?.scope || 'personal'}` === 'household'
    ? householdExpenses
    : personalExpenses;

  const monthRows = source.filter((expense) => `${expense?.date || ''}`.slice(0, 7) === month);
  return selectInsightEvidence(monthRows, 'category', insight?.metadata || {}, 8);
}

export function buildPreloadedInsightEvidence(insight, personalExpenses = [], householdExpenses = []) {
  const metadata = insight?.metadata || {};
  const month = `${metadata.month || ''}`.trim();
  if (!month) return [];

  const source = `${metadata.scope || 'personal'}` === 'household'
    ? householdExpenses
    : personalExpenses;
  const monthRows = source.filter((expense) => `${expense?.date || ''}`.slice(0, 7) === month);
  const mode = `${insight?.type || ''}` === 'early_cleanup'
    ? 'cleanup'
    : metadata.category_key
      ? 'category'
      : (metadata.merchant_key || metadata.merchant_name)
        ? 'merchant'
        : null;
  return selectInsightEvidence(monthRows, mode, metadata, 5);
}
