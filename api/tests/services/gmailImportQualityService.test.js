jest.mock('../../src/models/emailImportLog', () => ({
  summarizeByUser: jest.fn(),
  listQualitySignalsByUser: jest.fn(),
}));
jest.mock('../../src/models/gmailSenderPreference', () => ({
  findByUserAndDomain: jest.fn(),
  listByUser: jest.fn(),
}));

const EmailImportLog = require('../../src/models/emailImportLog');
const GmailSenderPreference = require('../../src/models/gmailSenderPreference');
const {
  getGmailImportQualitySummary,
  extractSenderDomain,
  getSenderImportQuality,
  recommendReviewMode,
} = require('../../src/services/gmailImportQualityService');

describe('gmailImportQualityService', () => {
  beforeEach(() => {
    EmailImportLog.summarizeByUser.mockReset();
    EmailImportLog.listQualitySignalsByUser.mockReset();
    GmailSenderPreference.findByUserAndDomain.mockReset();
    GmailSenderPreference.listByUser.mockReset();
    GmailSenderPreference.findByUserAndDomain.mockResolvedValue(null);
    GmailSenderPreference.listByUser.mockResolvedValue([]);
  });

  it('extracts sender domains from from-address strings', () => {
    expect(extractSenderDomain('Amazon Orders <orders@amazon.com>')).toBe('amazon.com');
    expect(extractSenderDomain('no-email-here')).toBe('unknown');
  });

  it('builds quality metrics and sender summaries', async () => {
    EmailImportLog.summarizeByUser.mockResolvedValue({
      window_days: 30,
      imported: 4,
      imported_pending_review: 1,
      skipped: 1,
      failed: 0,
      reviewed_approved: 2,
      reviewed_dismissed: 1,
      reviewed_edited: 2,
      approved_without_changes: 1,
      approved_after_changes: 1,
      reasons: [],
      changed_fields: [],
      last_imported_at: '2026-04-05T00:00:00.000Z',
    });
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      {
        from_address: 'orders@amazon.com',
        review_action: 'approved',
        review_edit_count: 0,
        review_changed_fields: [],
      },
      {
        from_address: 'orders@amazon.com',
        review_action: 'approved',
        review_edit_count: 1,
        review_changed_fields: ['merchant', 'review_path_full_review'],
      },
      {
        from_address: 'receipts@target.com',
        review_action: 'dismissed',
        review_edit_count: 0,
        review_changed_fields: [],
      },
      {
        from_address: 'receipts@target.com',
        review_action: null,
        review_edit_count: 1,
        review_changed_fields: ['amount', 'date'],
      },
    ]);

    const summary = await getGmailImportQualitySummary('user-1', 30, 5);

    expect(summary.quality).toMatchObject({
      total_reviewed: 4,
      clean_approved: 1,
      approved_after_changes: 1,
      dismissed: 1,
      edited: 2,
      clean_import_rate: 0.25,
      review_rate: 1,
      dismissal_rate: 0.25,
      edit_rate: 0.5,
    });
    expect(summary.debug).toMatchObject({
      sender_level_counts: {
        trusted: expect.any(Number),
        mixed: expect.any(Number),
        noisy: expect.any(Number),
        unknown: expect.any(Number),
      },
    });
    expect(summary.debug.top_corrected_fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'amount', count: 1 }),
      expect.objectContaining({ field: 'date', count: 1 }),
      expect.objectContaining({ field: 'merchant', count: 1 }),
    ]));
    expect(summary.debug.top_corrected_fields.find((entry) => entry.field === 'review_path_full_review')).toBeFalsy();
    expect(summary.quality.sender_quality).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender_domain: 'amazon.com',
        imported: 2,
        clean_approved: 1,
        approved_after_changes: 1,
        review_paths: expect.arrayContaining([
          expect.objectContaining({ path: 'full_review', count: 1 }),
        ]),
        item_reliability: expect.objectContaining({
          level: 'unknown',
        }),
        sender_preference: expect.objectContaining({ force_review: false }),
      }),
      expect.objectContaining({
        sender_domain: 'target.com',
        imported: 2,
        dismissed: 1,
        edited: 1,
        item_reliability: expect.objectContaining({
          level: 'unknown',
        }),
        sender_preference: expect.objectContaining({ force_review: false }),
      }),
    ]));
    expect(summary.debug.top_corrected_senders).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender_domain: 'target.com',
        top_changed_fields: expect.arrayContaining([
          expect.objectContaining({ field: 'amount', count: 1 }),
        ]),
      }),
    ]));
  });

  it('classifies sender domains as trusted or noisy based on review history', async () => {
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: [] },
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: [] },
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 1, review_changed_fields: ['merchant'] },
      { from_address: 'alerts@messy.com', review_action: 'dismissed', review_edit_count: 0 },
      { from_address: 'alerts@messy.com', review_action: null, review_edit_count: 1 },
      { from_address: 'alerts@messy.com', review_action: null, review_edit_count: 1 },
    ]);

    await expect(getSenderImportQuality('user-1', 'orders@amazon.com')).resolves.toMatchObject({
      sender_domain: 'amazon.com',
      level: 'trusted',
      metrics: expect.objectContaining({ imported: 3 }),
      item_reliability: expect.objectContaining({ level: 'trusted' }),
    });

    await expect(getSenderImportQuality('user-1', 'alerts@messy.com')).resolves.toMatchObject({
      sender_domain: 'messy.com',
      level: 'noisy',
      metrics: expect.objectContaining({ imported: 3 }),
    });
  });

  it('captures item reliability separately from top-level sender quality', async () => {
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      { from_address: 'orders@shop.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: [] },
      { from_address: 'orders@shop.com', review_action: 'approved', review_edit_count: 1, review_changed_fields: ['items_fee_rows_removed', 'items'] },
      { from_address: 'orders@shop.com', review_action: null, review_edit_count: 1, review_changed_fields: ['items_description', 'items_amount'] },
      { from_address: 'orders@shop.com', review_action: null, review_edit_count: 1, review_changed_fields: ['merchant'] },
    ]);

    await expect(getSenderImportQuality('user-1', 'orders@shop.com')).resolves.toMatchObject({
      sender_domain: 'shop.com',
      item_reliability: expect.objectContaining({
        level: 'noisy',
        edited: 2,
        top_signals: expect.arrayContaining([
          expect.objectContaining({ field: 'items', count: 1 }),
          expect.objectContaining({ field: 'items_amount', count: 1 }),
          expect.objectContaining({ field: 'items_description', count: 1 }),
        ]),
      }),
    });
  });

  it('tracks quick-check approvals separately from changed fields', async () => {
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'] },
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'] },
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 1, review_changed_fields: ['merchant', 'review_path_full_review'] },
    ]);

    await expect(getSenderImportQuality('user-1', 'orders@amazon.com')).resolves.toMatchObject({
      sender_domain: 'amazon.com',
      top_changed_fields: expect.arrayContaining([
        expect.objectContaining({ field: 'merchant', count: 1 }),
      ]),
      review_paths: expect.arrayContaining([
        expect.objectContaining({ path: 'quick_check', count: 2 }),
        expect.objectContaining({ path: 'full_review', count: 1 }),
      ]),
      review_path_reliability: expect.objectContaining({
        fast_lane_eligible: true,
        quick_check_count: 2,
      }),
    });
  });

  it('recommends quick_check when a trusted sender has earned the fast lane', () => {
    expect(recommendReviewMode({
      level: 'trusted',
      item_reliability: { level: 'mixed' },
      review_path_reliability: { fast_lane_eligible: true },
    })).toBe('quick_check');
  });

  it('forces full_review when the user opts a sender out of the fast lane', async () => {
    GmailSenderPreference.findByUserAndDomain.mockResolvedValue({
      force_review: true,
      sender_domain: 'amazon.com',
    });
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'] },
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'] },
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'] },
    ]);

    const senderQuality = await getSenderImportQuality('user-1', 'orders@amazon.com');
    expect(senderQuality.sender_preference.force_review).toBe(true);
    expect(recommendReviewMode(senderQuality)).toBe('full_review');
  });

  it('uses import-log feedback to make sender trust more conservative', async () => {
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'], user_feedback: 'needed_more_review' },
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'], user_feedback: 'needed_more_review' },
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'], user_feedback: null },
    ]);

    await expect(getSenderImportQuality('user-1', 'orders@amazon.com')).resolves.toMatchObject({
      sender_domain: 'amazon.com',
      level: 'noisy',
      metrics: expect.objectContaining({
        needed_more_review: 2,
        needed_more_review_rate: expect.any(Number),
      }),
      review_path_reliability: expect.objectContaining({
        fast_lane_eligible: false,
      }),
    });
  });
});
