jest.mock('../../src/db', () => ({ pool: { connect: jest.fn() } }));
jest.mock('../../src/models/emailImportLog', () => ({
  findByIdForUser: jest.fn(), recordLogFeedback: jest.fn(), upsertResult: jest.fn(), markRetryFailed: jest.fn(),
}));
jest.mock('../../src/models/expense', () => ({ create: jest.fn(), findPotentialDuplicates: jest.fn() }));
jest.mock('../../src/models/category', () => ({ findByHousehold: jest.fn() }));
jest.mock('../../src/services/gmailClient', () => ({ getMessage: jest.fn() }));
jest.mock('../../src/services/gmailImportQualityService', () => ({ getSenderImportQuality: jest.fn(), recommendReviewMode: jest.fn() }));
jest.mock('../../src/services/emailParser', () => ({
  ...jest.requireActual('../../src/services/emailParser'),
  classifyEmailExpense: jest.fn(), parseEmailExpense: jest.fn(), analyzeEmailSignals: jest.fn(),
}));
jest.mock('../../src/services/categoryAssigner', () => ({ assignCategory: jest.fn() }));
jest.mock('../../src/services/mapkitService', () => ({ searchPlace: jest.fn() }));
jest.mock('../../src/services/freshnessEvents', () => ({ emitExpenseFreshnessEvent: jest.fn() }));
jest.mock('../../src/services/projectionRefreshService', () => ({ requestProjectionRefresh: jest.fn() }));
jest.mock('../../src/services/duplicateDetector', () => jest.fn());

const db = require('../../src/db');
const Log = require('../../src/models/emailImportLog');
const Expense = require('../../src/models/expense');
const Category = require('../../src/models/category');
const { getMessage } = require('../../src/services/gmailClient');
const { classifyEmailExpense, parseEmailExpense, analyzeEmailSignals } = require('../../src/services/emailParser');
const { getSenderImportQuality, recommendReviewMode } = require('../../src/services/gmailImportQualityService');
const { assignCategory } = require('../../src/services/categoryAssigner');
const { emitExpenseFreshnessEvent } = require('../../src/services/freshnessEvents');
const detectDuplicates = require('../../src/services/duplicateDetector');
const { reviewSkippedImportLog, retryFailedImportLog } = require('../../src/services/gmailImporter');

const user = { id: 'user-1', household_id: 'household-1' };
const log = { id: 'log-1', message_id: 'message-1', status: 'skipped', skip_reason: 'template_skip_generic_receipt' };
let client;

beforeEach(() => {
  jest.resetAllMocks();
  client = { query: jest.fn().mockResolvedValue({ rows: [{ locked: true }] }), release: jest.fn() };
  db.pool.connect.mockResolvedValue(client);
  Log.findByIdForUser.mockResolvedValue(log);
  Category.findByHousehold.mockResolvedValue([]);
  getMessage.mockResolvedValue({ subject: 'Your receipt', from: 'orders@shop.com', body: 'Online purchase', snippet: 'Your receipt', receivedAt: '2026-09-20' });
  getSenderImportQuality.mockResolvedValue({ level: 'noisy', template_quality: { should_skip_prequeue: true } });
  recommendReviewMode.mockReturnValue('quick_check');
  classifyEmailExpense.mockResolvedValue({ disposition: 'not_expense' });
  analyzeEmailSignals.mockReturnValue({});
  parseEmailExpense.mockResolvedValue({ merchant: 'Shop', amount: 12, date: '2026-09-20', items: [] });
  Expense.findPotentialDuplicates.mockResolvedValue([]);
  Expense.create.mockResolvedValue({ id: 'expense-1', user_id: user.id, amount: 12, status: 'pending' });
  detectDuplicates.mockResolvedValue([]);
  assignCategory.mockResolvedValue({ category_id: null });
});

it('recovers a skipped email into full pending review and records corrective feedback', async () => {
  const result = await reviewSkippedImportLog(user, log);
  expect(result).toMatchObject({ imported: 1, expense: { status: 'pending' } });
  expect(Log.recordLogFeedback).toHaveBeenCalledWith(log.id, user.id, 'should_have_imported');
  expect(Expense.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', reviewMode: 'full_review', reviewRequired: true }));
  expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalled();
});

it('recovers a legacy duplicate skip into review without teaching classifier feedback', async () => {
  Log.findByIdForUser.mockResolvedValue({ ...log, skip_reason: 'duplicate_expense' });
  detectDuplicates.mockResolvedValue([{ id: 'flag-1', confidence: 'exact' }]);
  expect(await reviewSkippedImportLog(user, log)).toMatchObject({ imported: 1, skipped: 0 });
  expect(Expense.create).toHaveBeenCalled();
  expect(Log.recordLogFeedback).not.toHaveBeenCalled();
});

it('keeps emails without an amount out of expenses', async () => {
  parseEmailExpense.mockResolvedValue(null);
  expect(await reviewSkippedImportLog(user, log)).toMatchObject({ skipped: 1, reason: 'classifier_uncertain' });
  expect(Expense.create).not.toHaveBeenCalled();
});

it('does not create another expense when a retry has already completed', async () => {
  Log.findByIdForUser.mockResolvedValue({ ...log, status: 'imported', expense_id: 'expense-1' });
  expect(await reviewSkippedImportLog(user, log)).toMatchObject({ reason: 'existing' });
  expect(getMessage).not.toHaveBeenCalled();
  expect(Expense.create).not.toHaveBeenCalled();
});

it('rejects concurrent recovery and releases its connection', async () => {
  client.query.mockResolvedValue({ rows: [{ locked: false }] });
  await expect(reviewSkippedImportLog(user, log)).rejects.toMatchObject({ status: 409 });
  expect(getMessage).not.toHaveBeenCalled();
  expect(client.release).toHaveBeenCalled();
});

it('rechecks ownership before fetching Gmail content', async () => {
  Log.findByIdForUser.mockResolvedValue(null);
  await expect(reviewSkippedImportLog(user, log)).rejects.toMatchObject({ status: 404 });
  expect(getMessage).not.toHaveBeenCalled();
});

it('preserves existing message fingerprints when Gmail is unavailable', async () => {
  const silence = jest.spyOn(console, 'error').mockImplementation(() => {});
  getMessage.mockRejectedValue(new Error('Gmail not connected'));
  expect(await reviewSkippedImportLog(user, log)).toMatchObject({ failed: 1 });
  expect(Log.markRetryFailed).toHaveBeenCalledWith(log.id, user.id, expect.any(String));
  expect(Log.upsertResult).not.toHaveBeenCalled();
  silence.mockRestore();
});

it('retains the expense link if a later import step fails', async () => {
  const silence = jest.spyOn(console, 'error').mockImplementation(() => {});
  emitExpenseFreshnessEvent.mockRejectedValue(new Error('Freshness unavailable'));
  expect(await reviewSkippedImportLog(user, log)).toMatchObject({ failed: 1 });
  expect(Log.upsertResult).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', expenseId: 'expense-1' }));
  silence.mockRestore();
});

it('retries errors without recording a filtering correction', async () => {
  Log.findByIdForUser.mockResolvedValue({ ...log, status: 'failed' });
  await retryFailedImportLog(user, log);
  expect(Log.recordLogFeedback).not.toHaveBeenCalled();
});

it('does not suppress a valid fallback amount merely because prior detail edits made the sender noisy', async () => {
  Log.findByIdForUser.mockResolvedValue({ ...log, status: 'failed' });
  getSenderImportQuality.mockResolvedValue({ level: 'noisy', template_quality: { filtering_dismissals: 0 } });
  classifyEmailExpense.mockResolvedValue({ disposition: 'expense' });
  getMessage.mockResolvedValue({ subject: 'Your receipt', from: 'orders@shop.com', body: 'Online purchase. Total $12.00' });
  parseEmailExpense.mockResolvedValue(null);
  expect(await retryFailedImportLog(user, log)).toMatchObject({ imported: 1 });
  expect(Expense.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', amount: 12 }));
});
