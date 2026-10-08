jest.mock('../../src/db', () => ({
  query: jest.fn(),
}));
jest.mock('../../src/models/recurringPreference', () => ({
  findByHousehold: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/models/itemPlanningPreference', () => ({
  findByUser: jest.fn(),
}));
jest.mock('../../src/services/itemHistoryService', () => ({
  getItemHistoryByGroupKey: jest.fn(),
}));

const {
  detectRecurringItems,
  detectRecurringItemSignals,
  detectRecurringWatchCandidates,
} = require('../../src/services/recurringDetector');
const ItemPlanningPreference = require('../../src/models/itemPlanningPreference');
const { getItemHistoryByGroupKey } = require('../../src/services/itemHistoryService');

function itemOccurrence({
  date,
  amount = 16,
  category = 'Dining Out',
  merchant = 'Neighborhood Pizza',
} = {}) {
  return {
    expense_item_id: `item-${date}`,
    expense_id: `expense-${date}`,
    product_id: null,
    comparable_key: 'margherita pizza',
    product_match_confidence: 'high',
    item_name: 'Margherita Pizza',
    brand: null,
    merchant,
    expense_category_name: category,
    category_group_name: category,
    item_amount: amount,
    estimated_unit_price: null,
    normalized_total_size_value: null,
    normalized_total_size_unit: null,
    date: new Date(`${date}T12:00:00`),
  };
}

describe('recurring item insight context policy', () => {
  beforeEach(() => {
    ItemPlanningPreference.findByUser.mockReset();
    getItemHistoryByGroupKey.mockReset();
  });

  it('suppresses dining rows from recurring candidates and price signals', async () => {
    const occurrenceGroups = new Map([[
      'comparable:margherita pizza',
      [
        itemOccurrence({ date: '2026-08-01', amount: 15 }),
        itemOccurrence({ date: '2026-08-15', amount: 15 }),
        itemOccurrence({ date: '2026-08-29', amount: 20 }),
      ],
    ]]);

    await expect(detectRecurringItems('household-1', { occurrenceGroups })).resolves.toEqual([]);
    await expect(detectRecurringItemSignals('household-1', { occurrenceGroups })).resolves.toEqual([]);
  });

  it('builds cadence from product-friendly observations only', async () => {
    const occurrenceGroups = new Map([[
      'comparable:margherita pizza',
      [
        itemOccurrence({ date: '2026-07-01', amount: 15, category: 'Groceries' }),
        itemOccurrence({ date: '2026-07-08', amount: 30, category: 'Dining Out' }),
        itemOccurrence({ date: '2026-07-15', amount: 15, category: 'Groceries' }),
        itemOccurrence({ date: '2026-07-29', amount: 15, category: 'Groceries' }),
      ],
    ]]);

    const candidates = await detectRecurringItems('household-1', { occurrenceGroups });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      occurrence_count: 3,
      average_gap_days: 14,
      insight_eligibility: {
        eligible: true,
        excluded_reasons: ['dining_context'],
      },
    });
  });

  it('keeps an explicitly needed item even when it has no automatic candidate', async () => {
    ItemPlanningPreference.findByUser.mockResolvedValueOnce([{
      group_key: 'comparable:margherita pizza',
      state: 'needed',
      remind_on: null,
      target_price: 14,
    }]);
    getItemHistoryByGroupKey.mockResolvedValueOnce({
      group_key: 'comparable:margherita pizza',
      product_id: null,
      identity_confidence: 'high',
      item_name: 'Margherita Pizza',
      brand: null,
      occurrence_count: 3,
      average_gap_days: 14,
      median_amount: 16,
      median_unit_price: null,
      last_purchased_at: '2026-08-29',
      merchants: ['Neighborhood Pizza'],
      merchant_breakdown: [{ merchant: 'Neighborhood Pizza', occurrence_count: 3 }],
      normalized_total_size_value: null,
      normalized_total_size_unit: null,
    });

    const candidates = await detectRecurringWatchCandidates('household-1', {
      recurringItems: [],
      requesterUserId: 'user-1',
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      group_key: 'comparable:margherita pizza',
      item_name: 'Margherita Pizza',
      source: 'user_needed',
      status: 'due_today',
      days_until_due: 0,
      target_price: 14,
    });
  });
});
