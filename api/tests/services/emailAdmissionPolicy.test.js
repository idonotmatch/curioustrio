const {
  assessEmailAdmission,
  normalizeEmailMerchant,
  senderDisplayName,
  shouldQuarantineStoredImport,
} = require('../../src/services/emailAdmissionPolicy');

describe('emailAdmissionPolicy', () => {
  it.each([
    ['Newsletter', 'Free Pumpkin Picking & Pop-Ups This Weekend', 'newsletter.donyc.com', 'Tickets from $80'],
    ['news alert', 'Trump signs order to cut housing and mortgage costs', 'e.qz.com', 'Markets update for 2026'],
    ['retailer promotion', 'Wellbots Exclusive Deals: Save $300 on XGIMI', 'wellbots.com', 'XGIMI for $849'],
    ['reward offer', 'Your $10 Reward at Walmart', 'capitaloneshopping.com', 'Spend $60, Get $10'],
  ])('rejects %s without transaction evidence', (_label, subject, fromAddress, body) => {
    expect(assessEmailAdmission({ subject, fromAddress, body })).toMatchObject({
      admit: false,
    });
  });

  it('admits a concrete order confirmation', () => {
    expect(assessEmailAdmission({
      subject: 'Ordered 1 item: Pet Supplies',
      fromAddress: 'Amazon Orders <orders@amazon.com>',
      body: 'Order total: $33.16',
      classification: { disposition: 'expense' },
    })).toMatchObject({ admit: true, reason: 'transaction_evidence' });
  });

  it('admits an invoice attachment with a labeled total', () => {
    expect(assessEmailAdmission({
      subject: 'Invoice INV-42 from Bobby Boy Bakeshop',
      fromAddress: 'Bobby Boy Bakeshop <billing@bobbyboybakeshop.com>',
      body: 'Invoice number: INV-42\nAmount paid: $27.10',
      attachmentTextCount: 1,
      classification: { disposition: 'expense' },
    })).toMatchObject({ admit: true });
  });

  it('does not allow the classifier to rescue an evidence-free marketing email', () => {
    expect(assessEmailAdmission({
      subject: 'Classics Never Fade',
      fromAddress: 'Hibbett <email@hibbett.com>',
      body: 'Claim your iconic pair before they are gone. $250',
      classification: { disposition: 'expense' },
    })).toMatchObject({ admit: false, reason: 'no_transaction_evidence' });
  });

  it('respects a not-expense classification even when a total was found', () => {
    expect(assessEmailAdmission({
      subject: 'Your receipt from Example',
      fromAddress: 'Example <receipts@example.com>',
      body: 'Order total: $12.50',
      classification: { disposition: 'not_expense' },
    })).toMatchObject({ admit: false, reason: 'classifier_not_expense' });
  });

  it('requires stronger proof for promotional Gmail labels', () => {
    expect(assessEmailAdmission({
      subject: 'Save $20 this weekend',
      fromAddress: 'Shop <offers@shop.com>',
      body: 'Use this offer before it expires.',
      labelIds: ['CATEGORY_PROMOTIONS'],
    })).toMatchObject({ admit: false });
  });

  it('keeps a receipt with explicit transaction proof even when Gmail labels it promotional', () => {
    expect(assessEmailAdmission({
      subject: 'Your receipt from Example',
      fromAddress: 'Example <receipts@example.com>',
      body: 'Order total: $18.20\nManage email preferences',
      labelIds: ['CATEGORY_PROMOTIONS'],
      classification: { disposition: 'expense' },
    })).toMatchObject({ admit: true });
  });

  it('normalizes generic sender mailbox labels to the underlying brand', () => {
    expect(senderDisplayName('Newsletter <hello@newsletter.teacollection.com>')).toBe('Tea Collection');
    expect(normalizeEmailMerchant('E', 'News <news@e.washingtonpost.com>')).toBe('The Washington Post');
    expect(normalizeEmailMerchant('Amazon.com', 'orders@amazon.com')).toBe('Amazon.com');
    expect(normalizeEmailMerchant("McDonald's", 'receipts@mcdonalds.com')).toBe("McDonald's");
    expect(normalizeEmailMerchant('WHOLE FOODS MARKET', 'orders@wholefoodsmarket.com')).toBe('Whole Foods Market');
  });

  it('quarantines only obvious stored marketing context', () => {
    expect(shouldQuarantineStoredImport({
      subject: 'Google Alert - finance',
      fromAddress: 'alerts@google.com',
      snippet: 'Daily update',
    })).toBe(true);
    expect(shouldQuarantineStoredImport({
      subject: 'Your order confirmation',
      fromAddress: 'orders@example.com',
      snippet: 'Order total $18.20',
    })).toBe(false);
    expect(shouldQuarantineStoredImport({
      subject: "We're working on your order + 15% off",
      fromAddress: 'hello@example.com',
      snippet: 'Manage email preferences',
    })).toBe(false);
  });
});
