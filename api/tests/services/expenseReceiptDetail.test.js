jest.mock('../../src/db', () => ({ query: jest.fn() }));

const { normalizeDetails } = require('../../src/models/expenseReceiptDetail');

it('whitelists and bounds client-provided receipt details', () => {
  expect(normalizeDetails({
    currency: 'usd',
    subtotal: '12.50',
    transaction_id: ' TX-10 ',
    purchase_time: '14:05',
    store_number: '104',
    validation: {
      total_components_match: true,
      issues: ['item_sum_mismatch', 'unknown_issue'],
      uncertain_fields: ['amount', 'secret'],
      field_confidence: { amount: 'medium', unknown: 'high' },
      ignored: 'value',
    },
  })).toEqual({
    currency: 'USD',
    subtotal: 12.5,
    tax: null,
    tip: null,
    fees: null,
    discounts: null,
    transaction_id: 'TX-10',
    purchase_time: '14:05',
    store_number: '104',
    validation: {
      total_components_match: true,
      item_sum_matches_subtotal: null,
      issues: ['item_sum_mismatch'],
      uncertain_fields: ['amount'],
      field_confidence: { amount: 'medium' },
      items_truncated: false,
      visible_item_count: null,
      extracted_item_count: null,
    },
  });
});
