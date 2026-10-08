jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/models/expense', () => ({
  findByUser: jest.fn(),
  findByHousehold: jest.fn(),
}));
jest.mock('../../src/models/household', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/purchasePlan', () => ({ listByUser: jest.fn() }));

const db = require('../../src/db');
const Expense = require('../../src/models/expense');
const Household = require('../../src/models/household');
const PurchasePlan = require('../../src/models/purchasePlan');
const { buildSummaryBundle, periodBounds, SUMMARY_EXPENSE_LIMIT } = require('../../src/services/summaryBundleService');

describe('summaryBundleService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockImplementation((sql) => {
      if (sql.includes('COUNT(*)::int AS count')) return Promise.resolve({ rows: [{ count: 2 }] });
      if (sql.includes('JOIN users u')) return Promise.resolve({ rows: [{ limit: '900', spent: '275' }] });
      return Promise.resolve({ rows: [{ limit: '500', spent: '125' }] });
    });
    Household.findById.mockResolvedValue({ id: 'household-1', name: 'Home' });
    Expense.findByUser.mockResolvedValue([{ id: 'expense-1' }]);
    Expense.findByHousehold.mockResolvedValue([{ id: 'expense-1' }, { id: 'expense-2' }]);
    PurchasePlan.listByUser.mockResolvedValue([{
      id: 'plan-1',
      scope: 'personal',
      latest_snapshot: { material_change: 'unchanged', reserved_amount: '25', funding_gap: '75' },
    }]);
  });

  it('builds a compact monthly bundle with bounded expense preloads', async () => {
    const bundle = await buildSummaryBundle({
      user: { id: 'user-1', household_id: 'household-1' },
      period: '2026-10',
      startDay: 1,
    });

    expect(bundle).toMatchObject({
      schema_version: 3,
      period: '2026-10',
      member_count: 2,
      household: { id: 'household-1', name: 'Home' },
      personal_budget: { total: { limit: 500, spent: 125, remaining: 375 } },
      household_budget: { total: { limit: 900, spent: 275, remaining: 625 } },
      watched_plans: [expect.objectContaining({ id: 'plan-1', scope: 'personal', reserved_amount: 25, funding_gap: 75 })],
    });
    expect(Expense.findByUser).toHaveBeenCalledWith('user-1', expect.objectContaining({ limit: SUMMARY_EXPENSE_LIMIT }));
    expect(Expense.findByHousehold).toHaveBeenCalledWith('household-1', expect.objectContaining({ limit: SUMMARY_EXPENSE_LIMIT }));
    const householdBudgetCall = db.query.mock.calls.find(([sql]) => sql.includes('JOIN users u'));
    expect(householdBudgetCall[0]).toContain('(COALESCE(e.is_private, FALSE) = FALSE OR e.user_id = $4)');
    expect(householdBudgetCall[1]).toEqual(['household-1', '2026-10-01', '2026-11-01', 'user-1']);
  });

  it('computes custom budget period bounds', () => {
    expect(periodBounds('2026-10', 15)).toEqual({ from: '2026-10-15', to: '2026-11-15' });
  });
});
