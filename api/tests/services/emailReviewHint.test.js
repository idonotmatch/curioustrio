jest.mock('../../src/services/gmailImportQualityService', () => ({
  recommendReviewMode: jest.fn(() => 'full_review'),
}));

const { buildEmailFieldEvidence, buildEmailReviewHint, dateOnly } = require('../../src/services/emailReviewHint');

describe('emailReviewHint', () => {
  it('normalizes database Date values before building date evidence', () => {
    const result = buildEmailReviewHint({
      merchant: 'Corner Cafe',
      amount: 18.4,
      date: new Date('2026-10-04T00:00:00.000Z'),
    }, {
      message_id: 'message-1',
      imported_at: '2026-10-04T14:00:00.000Z',
      subject: 'Corner Cafe receipt',
      from_address: 'receipts@corner.example',
    }, { level: 'unknown' });

    expect(result.date_evidence).toBe('Date is based on when the email was received.');
  });

  it('identifies only weakly supported fields as questionable', () => {
    const result = buildEmailFieldEvidence({
      merchant: 'Corner Cafe',
      amount: 18.4,
      date: '2026-10-04',
      items: [],
    }, {
      message_id: 'message-2',
      imported_at: '2026-10-04T14:00:00.000Z',
      subject: 'Corner Cafe receipt',
      from_address: 'receipts@corner.example',
    });

    expect(result.field_confidence.merchant).toBe('high');
    expect(result.questionable_fields).toEqual(['amount']);
    expect(result.field_evidence.amount).toMatchObject({ confidence: 'low', questionable: true });
  });

  it('returns null for unusable date values', () => {
    expect(dateOnly(null)).toBeNull();
    expect(dateOnly('')).toBeNull();
    expect(dateOnly({ nope: true })).toBeNull();
  });

  it('uses deterministic amount assessment in the stored review evidence', () => {
    const result = buildEmailFieldEvidence({
      merchant: 'Apple Store', amount: 1, date: '2026-10-30', items: [],
    }, {
      message_id: 'message-3', imported_at: '2026-10-30T14:00:00.000Z',
      subject: 'We are processing your order', from_address: 'orders@apple.com',
    }, {}, {
      amountAssessment: {
        confidence: 'low',
        questionable: true,
        source: 'extraction',
        detail: 'The purchase includes financing or installments.',
        reason_codes: ['financing', 'trade_in'],
      },
    });

    expect(result.questionable_fields).toContain('amount');
    expect(result.field_evidence.amount).toMatchObject({
      confidence: 'low',
      questionable: true,
      reason_codes: ['financing', 'trade_in'],
    });
  });
});
