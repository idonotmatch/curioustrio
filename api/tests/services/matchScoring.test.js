const { buildMatchEvidence, scoreMatch } = require('../../src/services/matchScoring');

describe('matchScoring', () => {
  it('uses stable entity IDs ahead of mismatched display text', () => {
    const result = scoreMatch(
      { merchant: 'AMZN Mktp', merchant_entity_id: 'merchant-1', amount: 18.5, date: '2026-10-20' },
      { merchant: 'Amazon.com', merchant_entity_id: 'merchant-1', amount: 18.5, date: '2026-10-20' },
      { profile: 'duplicate' }
    );
    expect(result).toMatchObject({ confidence: 'exact', score: 100 });
  });

  it('applies Gmail lifecycle policy to the same shared evidence shape', () => {
    const result = scoreMatch(
      { merchant: 'Target', amount: 42, date: '2026-10-20', eventType: 'charge', senderRootDomain: 'target.com' },
      { merchant: 'Target', amount: 42, date: '2026-10-20', email_event_type: 'purchase_confirmation', sender_root_domain: 'target.com' },
      { profile: 'gmailLifecycle' }
    );
    expect(result).toMatchObject({ confidence: 'high' });
    expect(result.evidence).toEqual(expect.objectContaining({ merchantMatch: true, complementaryEvents: true }));
  });

  it('keeps branch and payment evidence independently inspectable', () => {
    expect(buildMatchEvidence(
      { payment_instrument_id: 'card-1', amount: 10, date: '2026-10-20' },
      { payment_instrument_id: 'card-1', amount: 10, date: '2026-10-21' },
      { placeMatch: false }
    )).toEqual(expect.objectContaining({ paymentMatch: true, paymentIdentityMatch: true, placeMatch: false }));
  });
});
