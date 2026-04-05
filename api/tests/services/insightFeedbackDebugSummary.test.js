const {
  buildFeedbackDebugSummary,
  extractRecentNotes,
  toSerializableSummary,
  summarizeFeedbackEvents,
} = require('../../src/services/insightFeedbackSummary');

describe('toSerializableSummary', () => {
  it('serializes and sorts feedback summary by signal strength', () => {
    const summary = summarizeFeedbackEvents([
      {
        insight_id: 'recurring_repurchase_due:product:abc:2026-04-08',
        event_type: 'helpful',
        metadata: { type: 'recurring_repurchase_due' },
        created_at: '2026-04-04T10:00:00Z',
      },
      {
        insight_id: 'spend_pace_ahead:personal:2026-04',
        event_type: 'not_helpful',
        metadata: { type: 'spend_pace_ahead', reason: 'not_relevant' },
        created_at: '2026-04-04T11:00:00Z',
      },
    ]);

    const rows = toSerializableSummary(summary);
    expect(rows[0].insight_type).toBe('recurring_repurchase_due');
    expect(rows[1].insight_type).toBe('spend_pace_ahead');
  });
});

describe('extractRecentNotes', () => {
  it('returns recent freeform feedback notes', () => {
    const notes = extractRecentNotes([
      {
        insight_id: 'spend_pace_ahead:personal:2026-04',
        event_type: 'not_helpful',
        metadata: { type: 'spend_pace_ahead', note: 'I had a one-time family trip this month.' },
        created_at: '2026-04-04T11:00:00Z',
      },
      {
        insight_id: 'recurring_repurchase_due:product:abc:2026-04-08',
        event_type: 'helpful',
        metadata: { type: 'recurring_repurchase_due' },
        created_at: '2026-04-04T10:00:00Z',
      },
    ]);

    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual(expect.objectContaining({
      insight_type: 'spend_pace_ahead',
      note: 'I had a one-time family trip this month.',
    }));
  });
});

describe('buildFeedbackDebugSummary', () => {
  it('returns totals, per-type summary, and recent notes', () => {
    const result = buildFeedbackDebugSummary([
      {
        insight_id: 'spend_pace_ahead:personal:2026-04',
        event_type: 'shown',
        metadata: { type: 'spend_pace_ahead' },
        created_at: '2026-04-04T09:00:00Z',
      },
      {
        insight_id: 'spend_pace_ahead:personal:2026-04',
        event_type: 'not_helpful',
        metadata: { type: 'spend_pace_ahead', reason: 'wrong_timing', note: 'This was travel-related.' },
        created_at: '2026-04-04T10:00:00Z',
      },
      {
        insight_id: 'recurring_repurchase_due:product:abc:2026-04-08',
        event_type: 'helpful',
        metadata: { type: 'recurring_repurchase_due' },
        created_at: '2026-04-04T11:00:00Z',
      },
    ]);

    expect(result.totals).toEqual(expect.objectContaining({
      shown: 1,
      not_helpful: 1,
      helpful: 1,
    }));
    expect(result.insight_types).toEqual(expect.arrayContaining([
      expect.objectContaining({ insight_type: 'spend_pace_ahead' }),
      expect.objectContaining({ insight_type: 'recurring_repurchase_due' }),
    ]));
    expect(result.recent_notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ note: 'This was travel-related.' }),
    ]));
  });
});
