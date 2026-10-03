jest.mock('../../src/db', () => ({ pool: { connect: jest.fn() } }));
jest.mock('../../src/models/expense', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/emailImportLog', () => ({ recordReviewFeedback: jest.fn() }));
jest.mock('../../src/services/expenseEmailReviewService', () => ({
  handleApprovedExpenseReview: jest.fn(async (expense) => expense),
  handleDismissedExpenseReview: jest.fn(async (expense) => expense),
  normalizeApprovedEmailNotes: jest.fn((notes) => notes),
}));

const db = require('../../src/db');
const Expense = require('../../src/models/expense');
const EmailImportLog = require('../../src/models/emailImportLog');
const {
  handleApprovedExpenseReview,
  handleDismissedExpenseReview,
} = require('../../src/services/expenseEmailReviewService');
const { resolveDuplicate, undoDuplicateMerge, buildMergeFieldSources } = require('../../src/services/duplicateResolutionService');

const user = { id: 'user-1', household_id: 'household-1' };
const current = { id: 'expense-new', user_id: user.id, household_id: user.household_id, source: 'email', status: 'pending', is_private: false };
const existing = { id: 'expense-old', user_id: user.id, household_id: user.household_id, source: 'manual', status: 'confirmed', is_private: false };
const flag = { id: 'flag-1', expense_id_a: current.id, expense_id_b: existing.id, status: 'pending' };

function mockClient() {
  const client = { release: jest.fn() };
  client.query = jest.fn(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM duplicate_flags')) return { rows: [flag] };
    if (sql.includes('FROM expenses')) return { rows: [current, existing] };
    if (sql.includes("SET status = 'dismissed'")) return { rows: [{ ...current, status: 'dismissed' }] };
    if (sql.includes('UPDATE duplicate_flags')) return { rows: [{ ...flag, status: 'dismissed' }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  db.pool.connect.mockResolvedValue(client);
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
  Expense.findById.mockResolvedValue(current);
  EmailImportLog.recordReviewFeedback.mockResolvedValue(null);
});

it('describes field-level merge precedence before persisting it', () => {
  expect(buildMergeFieldSources(
    { description: '', category_id: 'manual-category', notes: 'Family dinner', payment_method: 'unknown', location_provider_id: null },
    { description: 'Order 42', category_id: 'import-category', notes: 'Imported note', payment_method: 'credit', location_provider_id: 'apple-123' },
    { existingItemCount: 0, importedItemCount: 3 }
  )).toMatchObject({
    identity: 'existing',
    description: 'imported',
    category: 'existing',
    notes: 'existing',
    payment_method: 'imported',
    location_provider_id: 'imported',
    items: 'imported',
    budget_treatment: 'existing',
  });
});

it('keeps the existing expense only after explicitly dismissing the reviewed expense', async () => {
  const client = mockClient();
  const result = await resolveDuplicate({ user, expenseId: current.id, flagId: flag.id, action: 'keep_existing' });

  expect(result).toMatchObject({ action: 'keep_existing', dismissed_expense_id: current.id });
  expect(handleDismissedExpenseReview).toHaveBeenCalledWith(expect.objectContaining({ status: 'dismissed' }), user.id, 'duplicate');
  expect(handleApprovedExpenseReview).not.toHaveBeenCalled();
  expect(client.query).toHaveBeenCalledWith('COMMIT');
  expect(client.release).toHaveBeenCalled();
});

it('does not let a user replace another household member private expense', async () => {
  const client = mockClient();
  const privateExisting = { ...existing, user_id: 'user-2', is_private: true };
  client.query.mockImplementation(async (sql) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM duplicate_flags')) return { rows: [flag] };
    if (sql.includes('FROM expenses')) return { rows: [current, privateExisting] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  await expect(resolveDuplicate({ user, expenseId: current.id, flagId: flag.id, action: 'keep_new' }))
    .rejects.toMatchObject({ status: 404 });
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
});

it('keeps a new pending expense in review while another duplicate match remains', async () => {
  const client = { release: jest.fn() };
  client.query = jest.fn(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('SELECT * FROM duplicate_flags')) return { rows: [flag] };
    if (sql.includes('SELECT * FROM expenses')) return { rows: [current, existing] };
    if (sql.includes("UPDATE expenses SET status = 'dismissed'")) return { rows: [{ ...existing, status: 'dismissed' }] };
    if (sql.includes('SET status = $2')) return { rows: [{ ...flag, status: 'replaced' }] };
    if (sql.includes("SET status = 'replaced'")) return { rows: [] };
    if (sql.includes('SELECT COUNT(*)::int')) return { rows: [{ count: 1 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  db.pool.connect.mockResolvedValue(client);
  Expense.findById.mockResolvedValue(current);

  const result = await resolveDuplicate({ user, expenseId: current.id, flagId: flag.id, action: 'keep_new' });

  expect(result.expense.status).toBe('pending');
  expect(handleApprovedExpenseReview).not.toHaveBeenCalled();
  expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining("SET status = 'confirmed'"), expect.anything());
});

it('confirms a pending reviewed expense when the user keeps both and no duplicate flags remain', async () => {
  const client = { release: jest.fn() };
  client.query = jest.fn(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
    if (sql.includes('SELECT * FROM duplicate_flags')) return { rows: [flag] };
    if (sql.includes('SELECT * FROM expenses')) return { rows: [current, existing] };
    if (sql.includes('SET status = $2')) return { rows: [{ ...flag, status: 'kept_both' }] };
    if (sql.includes('SELECT COUNT(*)::int')) return { rows: [{ count: 0 }] };
    if (sql.includes("SET status = 'confirmed'")) return { rows: [{ ...current, status: 'confirmed' }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  db.pool.connect.mockResolvedValue(client);
  Expense.findById.mockResolvedValue({ ...current, status: 'confirmed' });

  const result = await resolveDuplicate({ user, expenseId: current.id, flagId: flag.id, action: 'keep_both' });

  expect(result.expense.status).toBe('confirmed');
  expect(handleApprovedExpenseReview).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }), user.id, 'full_review');
});

it('merges imported evidence into a manual survivor without replacing manual choices', async () => {
  const imported = {
    ...current,
    description: 'Order 42',
    category_id: 'category-imported',
    notes: 'Imported from Gmail',
    payment_method: 'credit',
    card_last4: '4242',
    place_name: 'Target Downtown',
  };
  const manual = {
    ...existing,
    description: null,
    category_id: 'category-manual',
    notes: 'Household supplies',
    payment_method: 'unknown',
    card_last4: null,
    place_name: null,
  };
  const mergedManual = {
    ...manual,
    description: imported.description,
    payment_method: imported.payment_method,
    card_last4: imported.card_last4,
    place_name: imported.place_name,
  };
  const client = { release: jest.fn() };
  client.query = jest.fn(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('SELECT * FROM duplicate_flags')) return { rows: [flag] };
    if (sql.includes('SELECT * FROM expenses')) return { rows: [imported, manual] };
    if (sql.includes('SELECT expense_id, COUNT(*)')) return { rows: [{ expense_id: imported.id, count: 3 }] };
    if (sql.includes('UPDATE expenses existing')) return { rows: [mergedManual] };
    if (sql.includes('UPDATE expense_items SET expense_id')) return { rows: [{ id: 'item-1' }, { id: 'item-2' }, { id: 'item-3' }], rowCount: 3 };
    if (sql.includes("SET status = 'dismissed'") && sql.includes('linked_expense_id')) {
      return { rows: [{ ...imported, status: 'dismissed', linked_expense_id: manual.id }] };
    }
    if (sql.includes('UPDATE email_import_log')) return { rows: [], rowCount: 1 };
    if (sql.includes('SET status = $2')) return { rows: [{ ...flag, status: 'merged' }] };
    if (sql.includes("SET status = 'merged'")) return { rows: [] };
    if (sql.includes('INSERT INTO expense_merge_events')) return { rows: [{ id: 'merge-event-1' }], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  db.pool.connect.mockResolvedValue(client);
  Expense.findById.mockResolvedValue(mergedManual);

  const result = await resolveDuplicate({ user, expenseId: imported.id, flagId: flag.id, action: 'merge_existing' });

  expect(result).toMatchObject({
    action: 'merge_existing',
    expense: { id: manual.id, category_id: 'category-manual', notes: 'Household supplies' },
    dismissed_expense_id: imported.id,
    surviving_expense_id: manual.id,
    merge_summary: { imported_items_count: 3 },
  });
  expect(EmailImportLog.recordReviewFeedback).toHaveBeenCalledWith(manual.id, {
    action: 'approved',
    changedFields: ['merged_into_existing'],
  });
  expect(client.query).toHaveBeenCalledWith(
    'UPDATE email_import_log SET expense_id = $1 WHERE expense_id = $2 AND user_id = $3',
    [manual.id, imported.id, user.id]
  );
});

it('undoes a recent merge and moves only transferred receipt items back', async () => {
  const mergeEvent = {
    id: 'merge-event-1',
    user_id: user.id,
    surviving_expense_id: existing.id,
    merged_expense_id: current.id,
    duplicate_flag_id: flag.id,
    survivor_before: existing,
    merged_before: current,
    transferred_item_ids: ['00000000-0000-4000-8000-000000000001'],
    created_at: new Date().toISOString(),
    undone_at: null,
  };
  const client = { release: jest.fn() };
  client.query = jest.fn(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM expense_merge_events')) return { rows: [mergeEvent] };
    if (sql.includes('UPDATE expenses SET')) return { rows: [{ ...current, status: 'pending' }] };
    if (sql.includes('UPDATE expense_items SET expense_id')) return { rows: [], rowCount: 1 };
    if (sql.includes('UPDATE email_import_log')) return { rows: [], rowCount: 1 };
    if (sql.includes('UPDATE duplicate_flags')) return { rows: [], rowCount: 1 };
    if (sql.includes('UPDATE expense_merge_events')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  db.pool.connect.mockResolvedValue(client);

  await expect(undoDuplicateMerge({ user, mergeEventId: mergeEvent.id })).resolves.toMatchObject({
    undone: true,
    restored_expense_id: current.id,
  });
  expect(client.query).toHaveBeenCalledWith(
    expect.stringContaining('id = ANY($3::uuid[])'),
    [current.id, existing.id, mergeEvent.transferred_item_ids]
  );
  expect(client.query).toHaveBeenCalledWith('COMMIT');
});
