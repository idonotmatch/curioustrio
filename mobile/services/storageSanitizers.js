function isPresent(value) {
  return value !== undefined && value !== null;
}

function sanitizeInsightMetadataValue(value) {
  if (
    value == null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const primitiveValues = value.filter((entry) =>
      entry == null
      || typeof entry === 'string'
      || typeof entry === 'number'
      || typeof entry === 'boolean'
    );
    return primitiveValues.length ? primitiveValues.slice(0, 12) : undefined;
  }

  return undefined;
}

function sanitizeInsightMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object') return {};
  const sanitized = {};
  for (const [key, value] of Object.entries(metadata)) {
    const nextValue = sanitizeInsightMetadataValue(value);
    if (nextValue !== undefined) sanitized[key] = nextValue;
  }
  return sanitized;
}

function sanitizeInsightAction(action = null) {
  if (!action || typeof action !== 'object') return null;
  const sanitized = {};
  for (const [key, value] of Object.entries(action)) {
    if (
      value == null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) {
      sanitized[key] = value;
    }
  }
  return Object.keys(sanitized).length ? sanitized : null;
}

function sanitizeInsightSnapshot(insight = {}) {
  const insightId = insight?.id;
  if (!insightId) return null;
  return {
    id: insightId,
    type: insight.type || '',
    title: insight.title || '',
    body: insight.body || '',
    severity: insight.severity || 'low',
    entity_type: insight.entity_type || '',
    entity_id: insight.entity_id || '',
    metadata: sanitizeInsightMetadata(insight.metadata || {}),
    action: sanitizeInsightAction(insight.action || null),
  };
}

function sanitizeExpenseItem(item = {}, index = 0) {
  if (!item || typeof item !== 'object') return null;
  const sanitized = {
    id: item.id || item.expense_item_id || `snapshot-item-${index}`,
    expense_item_id: item.expense_item_id || item.id || null,
    description: item.description || item.name || null,
    amount: isPresent(item.amount) ? item.amount : item.item_amount ?? null,
    quantity: isPresent(item.quantity) ? item.quantity : null,
    unit_price: isPresent(item.unit_price) ? item.unit_price : null,
    brand: item.brand || null,
    product_size: item.product_size || item.pack_size || null,
    unit: item.unit || null,
    item_type: item.item_type || null,
    product_id: item.product_id || null,
    estimated_unit_price: isPresent(item.estimated_unit_price) ? item.estimated_unit_price : null,
    comparable_key: item.comparable_key || null,
  };
  return sanitized;
}

function sanitizeExpenseItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => sanitizeExpenseItem(item, index))
    .filter(Boolean);
}

function sanitizeDuplicateFlags(flags = []) {
  if (!Array.isArray(flags)) return [];
  return flags
    .filter((flag) => flag && typeof flag === 'object')
    .map((flag) => ({
      id: flag.id || null,
      duplicate_expense_id: flag.duplicate_expense_id || null,
      reason: flag.reason || null,
      status: flag.status || null,
      confidence: isPresent(flag.confidence) ? flag.confidence : null,
      created_at: flag.created_at || null,
    }));
}

function sanitizeExpenseSnapshot(expense = {}) {
  const expenseId = expense?.id || expense?.expense_id || null;
  if (!expenseId) return null;
  const sanitizedItems = Array.isArray(expense.items) ? sanitizeExpenseItems(expense.items) : null;
  return {
    id: expenseId,
    user_id: expense.user_id || null,
    user_name: expense.user_name || null,
    household_id: expense.household_id || null,
    merchant: expense.merchant || null,
    description: expense.description || null,
    amount: isPresent(expense.amount) ? expense.amount : null,
    date: expense.date || null,
    source: expense.source || null,
    status: expense.status || null,
    review_source: expense.review_source || null,
    review_path: expense.review_path || null,
    category_id: expense.category_id || null,
    category_name: expense.category_name || null,
    category_parent_name: expense.category_parent_name || null,
    payment_method: expense.payment_method || 'unknown',
    card_label: expense.card_label || null,
    card_last4: expense.card_last4 || null,
    notes: expense.notes || null,
    is_private: expense.is_private === true,
    exclude_from_budget: expense.exclude_from_budget === true,
    budget_exclusion_reason: expense.budget_exclusion_reason || null,
    place_name: expense.place_name || null,
    address: expense.address || null,
    mapkit_stable_id: expense.mapkit_stable_id || null,
    duplicate_flags: sanitizeDuplicateFlags(expense.duplicate_flags || []),
    item_count: sanitizedItems ? sanitizedItems.length : Number(expense.item_count || 0),
    items: sanitizedItems,
  };
}

function sanitizeExpenseCollection(expenses = []) {
  if (!Array.isArray(expenses)) return [];
  return expenses
    .map((expense) => sanitizeExpenseSnapshot(expense))
    .filter(Boolean);
}

function sanitizeCurrentUserCache(user = {}) {
  if (!user || typeof user !== 'object') return null;
  const authUserId = user.auth_user_id || user.provider_uid || null;
  if (!authUserId) return null;
  return {
    id: user.id || null,
    auth_user_id: authUserId,
    name: user.name || null,
    household_id: user.household_id || null,
    budget_start_day: Number(user.budget_start_day || 1) || 1,
    push_gmail_review_enabled: user.push_gmail_review_enabled !== false,
    push_insights_enabled: user.push_insights_enabled !== false,
    push_recurring_enabled: user.push_recurring_enabled !== false,
    setup_mode: user.setup_mode || null,
    onboarding_complete: user.onboarding_complete === true,
    first_run_primary_choice: user.first_run_primary_choice || null,
  };
}

module.exports = {
  sanitizeCurrentUserCache,
  sanitizeExpenseCollection,
  sanitizeExpenseItems,
  sanitizeExpenseSnapshot,
  sanitizeInsightSnapshot,
};
