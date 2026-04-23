jest.mock('../../src/models/emailImportLog', () => ({
  summarizeByUser: jest.fn(),
  listQualitySignalsByUser: jest.fn(),
  listDecisionFeedbackByUser: jest.fn(),
  listTemplateSignalsByUser: jest.fn(),
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
  extractSubjectPattern,
  getSenderImportQuality,
  frequentDismissReason,
  recommendReviewMode,
} = require('../../src/services/gmailImportQualityService');

describe('gmailImportQualityService', () => {
  beforeEach(() => {
    EmailImportLog.summarizeByUser.mockReset();
    EmailImportLog.listQualitySignalsByUser.mockReset();
    EmailImportLog.listDecisionFeedbackByUser.mockReset();
    EmailImportLog.listTemplateSignalsByUser.mockReset();
    GmailSenderPreference.findByUserAndDomain.mockReset();
    GmailSenderPreference.listByUser.mockReset();
    GmailSenderPreference.findByUserAndDomain.mockResolvedValue(null);
    GmailSenderPreference.listByUser.mockResolvedValue([]);
    EmailImportLog.listDecisionFeedbackByUser.mockResolvedValue([]);
    EmailImportLog.listTemplateSignalsByUser.mockResolvedValue([]);
  });

  it('extracts sender domains from from-address strings', () => {
    expect(extractSenderDomain('Amazon Orders <orders@amazon.com>')).toBe('amazon.com');
    expect(extractSenderDomain('no-email-here')).toBe('unknown');
  });

  it('normalizes high-signal subject templates for amazon emails', () => {
    expect(extractSubjectPattern('ORDER: Placed on April 10', 'Amazon Orders <orders@amazon.com>')).toBe('amazon_order');
    expect(extractSubjectPattern('Your package has shipped', 'shipment-tracking@amazon.com')).toBe('amazon_shipping');
    expect(extractSubjectPattern('Refund processed for your return', 'orders@amazon.com')).toBe('amazon_refund');
  });

  it('generalizes common subject families across non-amazon senders', () => {
    expect(extractSubjectPattern('Receipt for your payment to Heather', 'service@paypal.com')).toBe('generic_receipt');
    expect(extractSubjectPattern('Your package has shipped', 'updates@shop.com')).toBe('generic_shipping');
    expect(extractSubjectPattern('Trip receipt from Uber', 'uber.us@uber.com')).toBe('generic_receipt');
    expect(extractSubjectPattern('Invoice #4821 from Notion', 'team-billing@notion.so')).toBe('generic_invoice');
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
    EmailImportLog.listTemplateSignalsByUser.mockResolvedValue([
      { from_address: 'orders@amazon.com', subject: 'ORDER: First', status: 'imported', review_action: 'approved', review_edit_count: 0, skip_reason: null, structured_item_block_level: 'strong', deterministic_item_count: 3 },
      { from_address: 'receipts@target.com', subject: 'Your package has shipped', status: 'skipped', review_action: null, review_edit_count: 0, skip_reason: 'template_skip_generic_shipping' },
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
    expect(summary.debug.top_templates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sender_domain: 'amazon.com',
        subject_pattern: 'amazon_order',
        structured_item_block_strong_count: 1,
        average_deterministic_item_count: 3,
      }),
      expect.objectContaining({
        sender_domain: 'target.com',
        subject_pattern: 'generic_shipping',
      }),
    ]));
  });

  it('classifies sender domains as trusted or noisy based on review history', async () => {
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      { from_address: 'orders@amazon.com', subject: 'ORDER: First', review_action: 'approved', review_edit_count: 0, review_changed_fields: [] },
      { from_address: 'orders@amazon.com', subject: 'ORDER: Second', review_action: 'approved', review_edit_count: 0, review_changed_fields: [] },
      { from_address: 'orders@amazon.com', subject: 'ORDER: Third', review_action: 'approved', review_edit_count: 1, review_changed_fields: ['merchant'] },
      { from_address: 'alerts@messy.com', review_action: 'dismissed', review_edit_count: 0 },
      { from_address: 'alerts@messy.com', review_action: null, review_edit_count: 1 },
      { from_address: 'alerts@messy.com', review_action: null, review_edit_count: 1 },
    ]);

    await expect(getSenderImportQuality('user-1', 'orders@amazon.com', 'ORDER: Latest')).resolves.toMatchObject({
      sender_domain: 'amazon.com',
      level: 'trusted',
      metrics: expect.objectContaining({ imported: 3 }),
      item_reliability: expect.objectContaining({ level: 'unknown' }),
      template_quality: expect.objectContaining({
        subject_pattern: 'amazon_order',
        force_import_review: true,
      }),
    });

    await expect(getSenderImportQuality('user-1', 'alerts@messy.com')).resolves.toMatchObject({
      sender_domain: 'messy.com',
      level: 'noisy',
      metrics: expect.objectContaining({ imported: 3 }),
    });
  });

  it('captures item reliability separately from top-level sender quality', async () => {
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      { from_address: 'orders@shop.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: [], structured_item_block_level: null, deterministic_item_count: 0 },
      { from_address: 'orders@shop.com', review_action: 'approved', review_edit_count: 1, review_changed_fields: ['items_fee_rows_removed', 'items'], structured_item_block_level: null, deterministic_item_count: 0 },
      { from_address: 'orders@shop.com', review_action: null, review_edit_count: 1, review_changed_fields: ['items_description', 'items_amount'], structured_item_block_level: null, deterministic_item_count: 0 },
      { from_address: 'orders@shop.com', review_action: null, review_edit_count: 1, review_changed_fields: ['items_summary_rows_removed'], structured_item_block_level: null, deterministic_item_count: 0 },
      { from_address: 'orders@shop.com', review_action: null, review_edit_count: 1, review_changed_fields: ['merchant'], structured_item_block_level: null, deterministic_item_count: 0 },
    ]);

    await expect(getSenderImportQuality('user-1', 'orders@shop.com')).resolves.toMatchObject({
      sender_domain: 'shop.com',
      item_reliability: expect.objectContaining({
        level: 'noisy',
        edited: 3,
        top_signals: expect.arrayContaining([
          expect.objectContaining({ field: 'items', count: 1 }),
          expect.objectContaining({ field: 'items_amount', count: 1 }),
          expect.objectContaining({ field: 'items_description', count: 1 }),
        ]),
      }),
    });
  });

  it('learns clean item approvals separately from generic clean approvals', async () => {
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      {
        from_address: 'receipts@coffee.test',
        review_action: 'approved',
        review_edit_count: 0,
        review_changed_fields: ['review_path_items_first', 'items_reviewed_clean'],
        structured_item_block_level: 'strong',
        deterministic_item_count: 5,
      },
      {
        from_address: 'receipts@coffee.test',
        review_action: 'approved',
        review_edit_count: 0,
        review_changed_fields: ['review_path_items_first', 'items_reviewed_clean'],
        structured_item_block_level: 'strong',
        deterministic_item_count: 4,
      },
      {
        from_address: 'receipts@coffee.test',
        review_action: 'approved',
        review_edit_count: 0,
        review_changed_fields: ['review_path_items_first', 'items_reviewed_clean'],
        structured_item_block_level: 'strong',
        deterministic_item_count: 6,
      },
    ]);

    await expect(getSenderImportQuality('user-1', 'receipts@coffee.test')).resolves.toMatchObject({
      item_reliability: expect.objectContaining({
        level: 'trusted',
        item_reviewed: 3,
        clean_item_approved: 3,
        clean_item_approval_rate: 1,
      }),
    });
  });

  it('learns template-level structured item blocks and prefers items-first review', async () => {
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      {
        from_address: 'hello@eightouncecoffee.ca',
        subject: 'Order #1 confirmed',
        review_action: 'approved',
        review_edit_count: 0,
        review_changed_fields: [],
        structured_item_block_level: 'strong',
        deterministic_item_count: 5,
      },
      {
        from_address: 'hello@eightouncecoffee.ca',
        subject: 'Order #2 confirmed',
        review_action: 'approved',
        review_edit_count: 0,
        review_changed_fields: [],
        structured_item_block_level: 'strong',
        deterministic_item_count: 4,
      },
      {
        from_address: 'hello@eightouncecoffee.ca',
        subject: 'Order #3 confirmed',
        review_action: 'approved',
        review_edit_count: 0,
        review_changed_fields: [],
        structured_item_block_level: 'none',
        deterministic_item_count: 0,
      },
    ]);
    EmailImportLog.listDecisionFeedbackByUser.mockResolvedValue([]);
    EmailImportLog.listTemplateSignalsByUser.mockResolvedValue([
      { from_address: 'hello@eightouncecoffee.ca', subject: 'Order #1 confirmed', status: 'imported', review_action: 'approved', review_edit_count: 0, skip_reason: null, structured_item_block_level: 'strong', deterministic_item_count: 5 },
      { from_address: 'hello@eightouncecoffee.ca', subject: 'Order #2 confirmed', status: 'imported', review_action: 'approved', review_edit_count: 0, skip_reason: null, structured_item_block_level: 'strong', deterministic_item_count: 4 },
      { from_address: 'hello@eightouncecoffee.ca', subject: 'Order #3 confirmed', status: 'imported', review_action: 'approved', review_edit_count: 0, skip_reason: null, structured_item_block_level: 'none', deterministic_item_count: 0 },
    ]);

    await expect(getSenderImportQuality('user-1', 'hello@eightouncecoffee.ca', 'Order #4 confirmed')).resolves.toMatchObject({
      template_quality: expect.objectContaining({
        structured_item_block_strong_count: 2,
        structured_item_block_strong_rate: expect.any(Number),
      }),
    });

    expect(recommendReviewMode({
      level: 'mixed',
      item_reliability: { level: 'unknown' },
      template_quality: {
        structured_item_block_strong_count: 2,
        structured_item_block_strong_rate: 0.6667,
      },
      review_path_reliability: { fast_lane_eligible: false },
      top_dismiss_reasons: [],
    })).toBe('items_first');
  });

  it('learns a transactional template outside amazon from repeated approvals', async () => {
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      { from_address: 'payments@service.com', subject: 'Receipt for your payment to Heather', review_action: 'approved', review_edit_count: 0, review_changed_fields: [] },
      { from_address: 'payments@service.com', subject: 'Receipt for your payment to John', review_action: 'approved', review_edit_count: 0, review_changed_fields: [] },
      { from_address: 'payments@service.com', subject: 'Receipt for your payment to Kelly', review_action: 'approved', review_edit_count: 1, review_changed_fields: ['merchant'] },
    ]);

    await expect(getSenderImportQuality('user-1', 'payments@service.com', 'Receipt for your payment to Mason')).resolves.toMatchObject({
      template_quality: expect.objectContaining({
        subject_pattern: 'generic_receipt',
        learned_disposition: 'transactional',
        force_import_review: true,
      }),
    });
  });

  it('learns a non-transactional template outside amazon from repeated dismissals', async () => {
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      { from_address: 'updates@shop.com', subject: 'Your package has shipped', review_action: 'dismissed', review_edit_count: 0, review_changed_fields: ['dismiss_reason_not_an_expense'] },
      { from_address: 'updates@shop.com', subject: 'Your package has shipped', review_action: 'dismissed', review_edit_count: 0, review_changed_fields: ['dismiss_reason_not_an_expense'] },
      { from_address: 'updates@shop.com', subject: 'Your package has shipped', review_action: null, review_edit_count: 0, review_changed_fields: [] },
    ]);

    await expect(getSenderImportQuality('user-1', 'updates@shop.com', 'Your package has shipped')).resolves.toMatchObject({
      template_quality: expect.objectContaining({
        subject_pattern: 'generic_shipping',
        learned_disposition: 'non_transactional',
        should_skip_prequeue: true,
      }),
    });
  });

  it('tracks quick-check approvals separately from changed fields', async () => {
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      { from_address: 'orders@amazon.com', subject: 'ORDER: First', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'] },
      { from_address: 'orders@amazon.com', subject: 'ORDER: Second', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'] },
      { from_address: 'orders@amazon.com', subject: 'ORDER: Third', review_action: 'approved', review_edit_count: 1, review_changed_fields: ['merchant', 'review_path_full_review'] },
    ]);

    await expect(getSenderImportQuality('user-1', 'orders@amazon.com', 'ORDER: Fourth')).resolves.toMatchObject({
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
      template_quality: expect.objectContaining({
        subject_pattern: 'amazon_order',
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

  it('identifies a repeated dismiss reason from sender history', () => {
    expect(frequentDismissReason({
      top_dismiss_reasons: [
        { reason: 'duplicate', count: 2 },
        { reason: 'wrong_details', count: 1 },
      ],
    })).toBe('duplicate');
  });

  it('keeps repeat duplicate or transfer dismissals out of quick check', () => {
    expect(recommendReviewMode({
      level: 'trusted',
      item_reliability: { level: 'trusted' },
      review_path_reliability: { fast_lane_eligible: true },
      top_dismiss_reasons: [
        { reason: 'duplicate', count: 3 },
      ],
    })).toBe('full_review');

    expect(recommendReviewMode({
      level: 'trusted',
      item_reliability: { level: 'trusted' },
      review_path_reliability: { fast_lane_eligible: true },
      top_dismiss_reasons: [
        { reason: 'transfer_or_payment', count: 2 },
      ],
    })).toBe('full_review');
  });

  it('uses import-log feedback to make sender trust more conservative', async () => {
    EmailImportLog.listQualitySignalsByUser.mockResolvedValue([
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'] },
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'] },
      { from_address: 'orders@amazon.com', review_action: 'approved', review_edit_count: 0, review_changed_fields: ['review_path_quick_check'] },
    ]);
    EmailImportLog.listDecisionFeedbackByUser.mockResolvedValue([
      { from_address: 'orders@amazon.com', user_feedback: 'needed_more_review' },
      { from_address: 'orders@amazon.com', user_feedback: 'needed_more_review' },
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
