import { toLocalDateString } from './date';

export function createManualExpenseDraft(overrides = {}) {
  const today = toLocalDateString();
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
