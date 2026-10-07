export function getInsightEvidenceMode(insightType, metadata = {}) {
  const type = `${insightType || ''}`;
  if (type === 'early_cleanup') return 'cleanup';
  if (metadata.category_key) return 'category';
  if (metadata.merchant_key || metadata.merchant_name) return 'merchant';
  if (metadata.largest_expense || metadata.top_unusual_expense) return 'largest_expense';
  if (['early_budget_pace', 'early_logging_momentum', 'developing_weekly_spend_change'].includes(type)) return 'period';
  return null;
}

export function getInsightEvidenceTitle(mode, metadata = {}) {
  if (mode === 'cleanup') return 'Expenses to clean up';
  if (mode === 'category') return `${metadata.category_name || 'Category'} activity`;
  if (mode === 'merchant') return `${metadata.merchant_name || 'Merchant'} activity`;
  if (mode === 'largest_expense') return 'Purchase behind the read';
  if (mode === 'period') return 'Recent period activity';
  return 'Recent evidence';
}

export function buildInsightPurchaseHistoryRows(metadata = {}) {
  const rows = Array.isArray(metadata.purchases) ? metadata.purchases : [];
  return rows
    .filter(Boolean)
    .map((row, index) => ({
      id: row.id || row.expense_id || null,
      expense_id: row.expense_id || row.id || null,
      expense_item_id: row.expense_item_id || null,
      key: row.expense_item_id || row.id || row.expense_id || `${row.date || 'date'}:${row.merchant || 'merchant'}:${index}`,
      date: row.date || null,
      merchant: row.merchant || null,
      amount: row.amount == null ? null : Number(row.amount),
      estimated_unit_price: row.estimated_unit_price == null ? null : Number(row.estimated_unit_price),
      normalized_total_size_value: row.normalized_total_size_value == null ? null : Number(row.normalized_total_size_value),
      normalized_total_size_unit: row.normalized_total_size_unit || null,
    }));
}
