jest.mock('../../src/models/emailImportLog', () => ({
  summarizeByUser: jest.fn(),
  listQualitySignalsByUser: jest.fn(),
}));

const EmailImportLog = require('../../src/models/emailImportLog');
const { getGmailImportQualitySummary, extractSenderDomain } = require('../../src/services/gmailImportQualityService');

describe('gmailImportQualityService', () => {
  beforeEach(() => {
    EmailImportLog.summarizeByUser.mockReset();
    EmailImportLog.listQualitySignalsByUser.mockReset();
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
        review_changed_fields: ['merchant'],
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
    expect(summary.quality.sender_quality).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender_domain: 'amazon.com',
        imported: 2,
        clean_approved: 1,
        approved_after_changes: 1,
      }),
      expect.objectContaining({
        sender_domain: 'target.com',
        imported: 2,
        dismissed: 1,
        edited: 1,
      }),
    ]));
  });
});
