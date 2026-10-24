const {
  buildReceiptFieldEvidence,
  canMergeSources,
  normalizeFieldEvidence,
  sourceRole,
} = require('../../src/services/importSourcePolicy');

describe('importSourcePolicy', () => {
  it('assigns sources to user, detail, and settlement roles', () => {
    expect(sourceRole('manual')).toBe('user');
    expect(sourceRole('camera')).toBe('detail');
    expect(sourceRole('email')).toBe('detail');
    expect(sourceRole('financekit')).toBe('settlement');
    expect(sourceRole('bank')).toBe('settlement');
  });

  it('allows detail imports into manual entries and settlement imports into detail entries', () => {
    expect(canMergeSources('camera', 'manual')).toBe(true);
    expect(canMergeSources('email', 'manual')).toBe(true);
    expect(canMergeSources('financekit', 'email')).toBe(true);
    expect(canMergeSources('email', 'camera')).toBe(false);
  });

  it('marks only uncertain receipt fields as questionable', () => {
    const evidence = buildReceiptFieldEvidence({
      field_confidence: { merchant: 'high', amount: 'low', items: 'medium' },
      uncertain_fields: ['amount'],
    });

    expect(evidence.merchant.questionable).toBe(false);
    expect(evidence.amount).toMatchObject({ confidence: 'low', questionable: true, source: 'receipt' });
    expect(evidence.items.questionable).toBe(false);
  });

  it('drops unknown fields and bounds evidence text', () => {
    const evidence = normalizeFieldEvidence({
      amount: { confidence: 'medium', detail: 'Final total', source: 'email' },
      secret_payload: { confidence: 'high', detail: 'do not retain' },
    });

    expect(evidence).toEqual({
      amount: { confidence: 'medium', questionable: false, detail: 'Final total', source: 'email' },
    });
  });
});
