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
        expense_item_id: 'item-1',
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
        expense_item_id: 'item-2',
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
        expense_item_id: 'item-3',
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
      prior_median_amount: 6.24,
      baseline_purchase_count: 2,
      merchants: ['Target', 'Whole Foods'],
      last_purchased_at: '2026-04-20',
      next_expected_date: '2026-04-29',
    });
    expect(summaries[0].merchant_breakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ merchant: 'Target', occurrence_count: 2 }),
      expect.objectContaining({ merchant: 'Whole Foods', occurrence_count: 1 }),
    ]));
    expect(summaries[0].purchases).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'expense-1', expense_item_id: 'item-1', item_amount: 5.99 }),
      expect.objectContaining({ id: 'expense-2', expense_item_id: 'item-2', item_amount: 6.49 }),
      expect.objectContaining({ id: 'expense-3', expense_item_id: 'item-3', item_amount: 5.79 }),
    ]));
  });

  it('does not group a user-rejected item identity into history', () => {
    const summaries = summarizeHistoryRows([
      {
        expense_item_id: 'item-rejected',
        expense_id: 'expense-1',
        comparable_key: 'sparkling water',
        product_match_reason: 'user_rejected_match',
        item_name: 'Sparkling Water',
        item_amount: 5.99,
        merchant: 'Target',
        date: '2026-04-01',
      },
    ]);

    expect(summaries).toEqual([]);
  });

  it('does not group redacted email metadata into item history', () => {
    const summaries = summarizeHistoryRows([
      {
        expense_item_id: 'item-redacted',
        expense_id: 'expense-confirmed',
        comparable_key: 'restaurant peace haven redacted address winston salem nc 27106',
        product_match_confidence: 'medium',
        item_name: 'Restaurant Peace Haven #[redacted-address] Winston Salem, NC 27106',
        item_amount: 1,
        merchant: 'Chick-fil-A',
        date: '2026-09-11',
      },
    ]);

    expect(summaries).toEqual([]);
  });

  it('does not group tax lines into item history', () => {
    const summaries = summarizeHistoryRows([
      {
        expense_item_id: 'item-tax',
        expense_id: 'expense-confirmed',
        comparable_key: 'local sale tax',
        product_match_confidence: 'medium',
        item_name: 'Local sales tax',
        item_amount: 1.42,
        merchant: 'Retailer',
        date: '2026-09-11',
      },
    ]);

    expect(summaries).toEqual([]);
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

    const results = await listItemHistorySummaries('household-1', {
      minOccurrences: 2,
      requesterUserId: 'user-1',
    });

    expect(results).toHaveLength(1);
    expect(results[0].group_key).toBe('comparable:organic banana');
    expect(db.query.mock.calls[0][0]).toContain('(COALESCE(e.is_private, FALSE) = FALSE OR e.user_id = $3)');
    expect(db.query.mock.calls[0][0]).toContain("COALESCE(ei.product_match_reason, '') <> 'user_rejected_match'");
    expect(db.query.mock.calls[0][1]).toEqual(['household-1', 180, 'user-1']);
  });

  it('suppresses dining items from automatic insight summaries', async () => {
    db.query.mockResolvedValueOnce({
      rows: [1, 2, 3].map((index) => ({
        expense_id: `expense-${index}`,
        comparable_key: 'margherita pizza',
        product_match_confidence: 'high',
        item_name: 'Margherita Pizza',
        item_amount: 16,
        merchant: 'Neighborhood Pizza',
        date: `2026-04-${`${index * 7}`.padStart(2, '0')}`,
        expense_category_name: 'Dining Out',
        category_group_name: 'Dining Out',
      })),
    });

    const results = await listItemHistorySummaries('household-1', {
      minOccurrences: 3,
      requesterUserId: 'user-1',
      automaticInsightsOnly: true,
    });

    expect(results).toEqual([]);
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

    const result = await getItemHistoryByGroupKey('household-1', 'product:product-123', {
      requesterUserId: 'user-1',
    });

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
    expect(db.query.mock.calls[0][1]).toEqual(['household-1', 180, 'user-1', 'product-123']);
  });

  it('keeps dining item history available with its suppression reason', async () => {
    db.query.mockResolvedValueOnce({
      rows: [1, 2, 3].map((index) => ({
        expense_id: `expense-${index}`,
        comparable_key: 'margherita pizza',
        product_match_confidence: 'high',
        item_name: 'Margherita Pizza',
        item_amount: 16,
        merchant: 'Neighborhood Pizza',
        date: `2026-04-${`${index * 7}`.padStart(2, '0')}`,
        expense_category_name: 'Dining Out',
        category_group_name: 'Dining Out',
      })),
    });

    const result = await getItemHistoryByGroupKey(
      'household-1',
      'comparable:margherita pizza',
      { requesterUserId: 'user-1' }
    );

    expect(result).toMatchObject({
      item_name: 'Margherita Pizza',
      occurrence_count: 3,
      insight_eligibility: {
        eligible: false,
        suppressed_reason: 'dining_context',
      },
    });
  });
});
