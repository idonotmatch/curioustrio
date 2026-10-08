jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/models/recurringPreference', () => ({ findByHousehold: jest.fn() }));

const db = require('../../src/db');
const {
  detectRecurringItems,
  detectRecurringItemSignals,
  detectRecurringWatchCandidates,
} = require('../../src/services/recurringDetector');

function occurrence(date, amount) {
  return {
    expense_item_id: `item-${date}`,
    expense_id: `expense-${date}`,
    product_id: 'product-1',
    comparable_key: 'coffee:12oz',
    product_match_confidence: 'high',
    item_name: 'Coffee',
    brand: 'Adlo Roast',
    merchant: 'Market',
    item_amount: amount,
    estimated_unit_price: amount / 12,
    normalized_total_size_value: 12,
    normalized_total_size_unit: 'oz',
    date: new Date(`${date}T12:00:00Z`),
  };
}

describe('recurring analysis reuse', () => {
  beforeEach(() => {
    db.query.mockReset();
  });

  it('derives candidates and signals from one preloaded occurrence map', async () => {
    const occurrenceGroups = new Map([[
      'product:product-1',
      [
        occurrence('2026-01-01', 12),
        occurrence('2026-01-15', 12),
        occurrence('2026-01-29', 14),
      ],
    ]]);

    const recurringItems = await detectRecurringItems('user-1', {
      scope: 'personal',
      occurrenceGroups,
    });
    const signals = await detectRecurringItemSignals('user-1', {
      scope: 'personal',
      occurrenceGroups,
    });
    await detectRecurringWatchCandidates('user-1', {
      scope: 'personal',
      recurringItems,
      windowDays: 365,
      maxOverdueDays: 365,
    });

    expect(recurringItems).toHaveLength(1);
    expect(signals).toHaveLength(1);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects redacted metadata even when a preloaded group repeats', async () => {
    const redacted = (date) => ({
      ...occurrence(date, 1),
      product_id: null,
      comparable_key: 'restaurant peace haven redacted address winston salem nc 27106',
      product_match_confidence: 'medium',
      item_name: 'Restaurant Peace Haven #[redacted-address] Winston Salem, NC 27106',
    });
    const occurrenceGroups = new Map([[
      'comparable:restaurant peace haven redacted address winston salem nc 27106',
      [redacted('2026-01-01'), redacted('2026-01-15'), redacted('2026-01-29'), redacted('2026-02-12')],
    ]]);

    await expect(detectRecurringItems('user-1', {
      scope: 'personal',
      occurrenceGroups,
    })).resolves.toEqual([]);
    await expect(detectRecurringItemSignals('user-1', {
      scope: 'personal',
      occurrenceGroups,
    })).resolves.toEqual([]);
  });
});
