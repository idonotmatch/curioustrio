jest.mock('../../src/db', () => ({
  query: jest.fn(),
}));

const db = require('../../src/db');
const {
  inferableOutcomeConfig,
  parseGroupKeyFromInsight,
  parseProjectionContextFromInsight,
  inferOutcomeEventsForUser,
} = require('../../src/services/insightOutcomeInference');

describe('inferableOutcomeConfig', () => {
  it('returns config only for supported inferable opportunity types', () => {
    expect(inferableOutcomeConfig('recurring_restock_window')).toEqual(
      expect.objectContaining({ outcomeType: 'restocked_item', windowDays: 10 })
    );
    expect(inferableOutcomeConfig('spend_pace_ahead')).toBeNull();
  });
});

describe('parseGroupKeyFromInsight', () => {
  it('extracts group keys from recurring opportunity insight ids', () => {
    expect(parseGroupKeyFromInsight({
      insight_id: 'recurring_restock_window:product:abc:2026-04',
    })).toBe('product:abc');

    expect(parseGroupKeyFromInsight({
      insight_id: 'buy_soon_better_price:comparable:diapers:Target:2026-04-05',
    })).toBe('comparable:diapers');
  });
});

describe('parseProjectionContextFromInsight', () => {
  it('extracts scope, month, and category context from projection insight ids', () => {
    expect(parseProjectionContextFromInsight({
      insight_id: 'projected_category_under:household:2026-04:category-123',
    })).toEqual({
      scope: 'household',
      month: '2026-04',
      categoryKey: 'category-123',
    });

    expect(parseProjectionContextFromInsight({
      insight_id: 'projected_under_budget:personal:2026-04',
    })).toEqual({
      scope: 'personal',
      month: '2026-04',
      categoryKey: null,
    });
  });
});

describe('inferOutcomeEventsForUser', () => {
  const user = { id: 'user-1', household_id: 'household-1' };

  beforeEach(() => {
    db.query.mockReset();
  });

  it('infers an acted outcome when a matching recurring item is purchased soon after shown', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        expense_id: 'expense-1',
        date: '2026-04-07',
        created_at: '2026-04-07T15:00:00Z',
        merchant: 'Target',
        description: 'Pampers Pure Size 6',
      }],
    });

    const inferred = await inferOutcomeEventsForUser({
      user,
      events: [{
        insight_id: 'recurring_restock_window:product:abc:2026-04',
        event_type: 'shown',
        metadata: { surface: 'summary' },
        created_at: '2026-04-05T10:00:00Z',
      }],
    });

    expect(inferred).toEqual([
      expect.objectContaining({
        insight_id: 'recurring_restock_window:product:abc:2026-04',
        event_type: 'acted',
        metadata: expect.objectContaining({
          insight_type: 'recurring_restock_window',
          outcome_type: 'restocked_item',
          inferred: true,
          group_key: 'product:abc',
          matched_expense_id: 'expense-1',
        }),
      }),
    ]);
  });

  it('does not infer a duplicate acted outcome when one is already logged', async () => {
    const inferred = await inferOutcomeEventsForUser({
      user,
      events: [
        {
          insight_id: 'recurring_restock_window:product:abc:2026-04',
          event_type: 'shown',
          metadata: { surface: 'summary' },
          created_at: '2026-04-05T10:00:00Z',
        },
        {
          insight_id: 'recurring_restock_window:product:abc:2026-04',
          event_type: 'acted',
          metadata: { outcome_type: 'restocked_item' },
          created_at: '2026-04-06T10:00:00Z',
        },
      ],
    });

    expect(inferred).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('ignores unsupported insight types', async () => {
    const inferred = await inferOutcomeEventsForUser({
      user,
      events: [{
        insight_id: 'spend_pace_ahead:personal:2026-04',
        event_type: 'shown',
        metadata: { type: 'spend_pace_ahead' },
        created_at: '2026-04-05T10:00:00Z',
      }],
    });

    expect(inferred).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('infers category headroom outcomes when spend lands in the suggested category', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        expense_id: 'expense-2',
        date: '2026-04-08',
        created_at: '2026-04-08T16:00:00Z',
        merchant: 'Trader Joe\'s',
        amount: 34,
      }],
    });

    const inferred = await inferOutcomeEventsForUser({
      user,
      events: [{
        insight_id: 'projected_category_under:household:2026-04:groceries-cat',
        event_type: 'shown',
        metadata: { type: 'projected_category_under_baseline' },
        created_at: '2026-04-05T10:00:00Z',
      }],
    });

    expect(inferred).toEqual([
      expect.objectContaining({
        insight_id: 'projected_category_under:household:2026-04:groceries-cat',
        event_type: 'acted',
        metadata: expect.objectContaining({
          insight_type: 'projected_category_under_baseline',
          outcome_type: 'used_category_headroom',
          category_key: 'groceries-cat',
          matched_expense_id: 'expense-2',
        }),
      }),
    ]);
  });

  it('infers under-budget outcomes when meaningful spend happens after the nudge', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        expense_id: 'expense-3',
        date: '2026-04-09',
        created_at: '2026-04-09T18:00:00Z',
        merchant: 'Target',
        amount: 52,
      }],
    });

    const inferred = await inferOutcomeEventsForUser({
      user,
      events: [{
        insight_id: 'projected_under_budget:household:2026-04',
        event_type: 'tapped',
        metadata: { type: 'projected_month_end_under_budget' },
        created_at: '2026-04-05T10:00:00Z',
      }],
    });

    expect(inferred).toEqual([
      expect.objectContaining({
        insight_id: 'projected_under_budget:household:2026-04',
        event_type: 'acted',
        metadata: expect.objectContaining({
          insight_type: 'projected_month_end_under_budget',
          outcome_type: 'used_budget_headroom',
          matched_expense_id: 'expense-3',
          matched_amount: 52,
        }),
      }),
    ]);
  });
});
