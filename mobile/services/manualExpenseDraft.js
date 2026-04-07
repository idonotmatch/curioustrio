export function createManualExpenseDraft(overrides = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    merchant: '',
    description: '',
    amount: 0,
    date: today,
    category_id: null,
    category_name: null,
    source: 'manual',
    notes: '',
    payment_method: 'unknown',
    card_label: '',
    field_confidence: {},
    review_fields: [],
    items: [],
    ...overrides,
  };
}
