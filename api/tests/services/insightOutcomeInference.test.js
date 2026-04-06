jest.mock('../../src/db', () => ({
  query: jest.fn(),
}));

const db = require('../../src/db');
const {
  inferableOutcomeConfig,
  parseGroupKeyFromInsight,
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
});
