jest.mock('../../src/db', () => ({
  query: jest.fn(),
}));

const db = require('../../src/db');
const {
  summarizeHistoryRows,
  listItemHistorySummaries,
  getItemHistoryByGroupKey,
} = require('../../src/services/itemHistoryService');

beforeEach(() => {
  db.query.mockReset();
});

describe('summarizeHistoryRows', () => {
  it('groups rows by stable identity and summarizes recent item history', () => {
    const summaries = summarizeHistoryRows([
      {
        expense_id: 'expense-1',
        comparable_key: 'sparkling water lime|brand:water co|size:12oz|pack:8',
        product_match_confidence: 'medium',
        item_name: 'Sparkling Water Lime',
        brand: 'Water Co',
        item_amount: 5.99,
        estimated_unit_price: 0.0624,
        normalized_total_size_value: 96,
        normalized_total_size_unit: 'oz',
        merchant: 'Target',
        date: '2026-04-01',
      },
      {
        expense_id: 'expense-2',
        comparable_key: 'sparkling water lime|brand:water co|size:12oz|pack:8',
        product_match_confidence: 'medium',
        item_name: 'Sparkling Water Lime',
        brand: 'Water Co',
        item_amount: 6.49,
        estimated_unit_price: 0.0676,
        normalized_total_size_value: 96,
        normalized_total_size_unit: 'oz',
        merchant: 'Whole Foods',
        date: '2026-04-10',
      },
      {
        expense_id: 'expense-3',
        comparable_key: 'sparkling water lime|brand:water co|size:12oz|pack:8',
        product_match_confidence: 'medium',
        item_name: 'Sparkling Water Lime',
        brand: 'Water Co',
        item_amount: 5.79,
        estimated_unit_price: 0.0603,
        normalized_total_size_value: 96,
        normalized_total_size_unit: 'oz',
        merchant: 'Target',
        date: '2026-04-20',
      },
    ]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      group_key: 'comparable:sparkling water lime|brand:water co|size:12oz|pack:8',
      occurrence_count: 3,
      average_gap_days: 9.5,
      median_amount: 5.99,
      median_unit_price: 0.0624,
      merchants: ['Target', 'Whole Foods'],
      last_purchased_at: '2026-04-20',
    });
    expect(summaries[0].merchant_breakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ merchant: 'Target', occurrence_count: 2 }),
      expect.objectContaining({ merchant: 'Whole Foods', occurrence_count: 1 }),
    ]));
    expect(summaries[0].purchases).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'expense-1' }),
      expect.objectContaining({ id: 'expense-2' }),
      expect.objectContaining({ id: 'expense-3' }),
    ]));
  });
});

describe('listItemHistorySummaries', () => {
  it('loads rows from db and applies the minimum occurrence threshold', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        {
          expense_id: 'expense-1',
          comparable_key: 'organic banana',
          product_match_confidence: 'medium',
          item_name: 'Organic Bananas',
          brand: null,
          item_amount: 2.99,
          estimated_unit_price: null,
          normalized_total_size_value: null,
          normalized_total_size_unit: null,
          merchant: 'Whole Foods',
          date: '2026-04-01',
        },
        {
          expense_id: 'expense-2',
          comparable_key: 'organic banana',
          product_match_confidence: 'medium',
          item_name: 'Organic Bananas',
          brand: null,
          item_amount: 3.29,
          estimated_unit_price: null,
          normalized_total_size_value: null,
          normalized_total_size_unit: null,
          merchant: 'Whole Foods',
          date: '2026-04-08',
        },
        {
          expense_id: 'expense-3',
          comparable_key: 'one off item',
          product_match_confidence: 'medium',
          item_name: 'One Off Item',
          brand: null,
          item_amount: 8.99,
          estimated_unit_price: null,
          normalized_total_size_value: null,
          normalized_total_size_unit: null,
          merchant: 'Target',
          date: '2026-04-04',
        },
      ],
    });

    const results = await listItemHistorySummaries('household-1', { minOccurrences: 2 });

    expect(results).toHaveLength(1);
    expect(results[0].group_key).toBe('comparable:organic banana');
  });
});

describe('getItemHistoryByGroupKey', () => {
  it('returns one history summary for a requested group key', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        {
          expense_id: 'expense-1',
          product_id: 'product-123',
          comparable_key: null,
          product_match_confidence: 'high',
          item_name: 'Pampers Pure',
          brand: 'Pampers',
          item_amount: 39.23,
          estimated_unit_price: 0.4784,
          normalized_total_size_value: 82,
          normalized_total_size_unit: 'count',
          merchant: 'Target',
          date: '2026-04-01',
        },
        {
          expense_id: 'expense-2',
          product_id: 'product-123',
          comparable_key: null,
          product_match_confidence: 'high',
          item_name: 'Pampers Pure',
          brand: 'Pampers',
          item_amount: 40.5,
          estimated_unit_price: 0.4939,
          normalized_total_size_value: 82,
          normalized_total_size_unit: 'count',
          merchant: 'Target',
          date: '2026-04-22',
        },
      ],
    });

    const result = await getItemHistoryByGroupKey('household-1', 'product:product-123');

    expect(result).toMatchObject({
      group_key: 'product:product-123',
      identity_confidence: 'high',
      item_name: 'Pampers Pure',
      occurrence_count: 2,
      median_amount: 39.865,
    });
    expect(result.purchases).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'expense-1' }),
      expect.objectContaining({ id: 'expense-2' }),
    ]));
  });
});
