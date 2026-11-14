const { assessEmailAmount } = require('../../src/services/emailAmountAssessment');

describe('emailAmountAssessment', () => {
  it('trusts an amount tied to an explicit settled charge', () => {
    expect(assessEmailAmount({
      body: 'Your card was charged. Total charged: $27.10',
      parsedAmount: 27.1,
    })).toMatchObject({
      confidence: 'high', source: 'settled_total', questionable: false,
    });
  });

  it('routes estimated order totals to full review', () => {
    expect(assessEmailAmount({
      body: 'Estimated total $66.51. Your final total may change when the order ships.',
      parsedAmount: 66.51,
    })).toMatchObject({
      confidence: 'low', questionable: true, requires_full_review: true,
      reason_codes: expect.arrayContaining(['estimated_total']),
    });
  });

  it('does not confuse trade-in value with a settled purchase charge', () => {
    expect(assessEmailAmount({
      body: 'Amount financed $1.00. Trade-in refund of $1,200 may apply after verification.',
      parsedAmount: 1,
    })).toMatchObject({
      confidence: 'low',
      reason_codes: expect.arrayContaining(['financing', 'trade_in']),
    });
  });

  it('uses balanced line items as medium evidence when no final total is labeled', () => {
    expect(assessEmailAmount({
      body: 'Thanks for your purchase',
      parsedAmount: 19.5,
      items: [{ amount: 15 }, { amount: 4.5 }],
    })).toMatchObject({
      confidence: 'medium', source: 'line_items', questionable: false,
    });
  });

  it('recognizes an explicit refund total', () => {
    expect(assessEmailAmount({
      body: 'Your refund has been processed. Refund amount: $19.25',
      parsedAmount: -19.25,
      eventType: 'refund',
    })).toMatchObject({
      confidence: 'high', source: 'refund_total', questionable: false,
    });
  });
});
