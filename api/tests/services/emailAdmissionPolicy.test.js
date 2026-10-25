const {
  assessEmailAdmission,
  assessStoredImport,
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

  it('recognizes merchant names embedded in received-order subjects', () => {
    expect(assessEmailAdmission({
      subject: "We've Received Your Hanna Order!",
      fromAddress: 'Hanna Andersson <info@e.o.hannaandersson.com>',
      body: 'Thank you for your purchase. Order total: $210.20',
      classification: { disposition: 'expense' },
    })).toMatchObject({ admit: true });
    expect(assessStoredImport({
      subject: "We've Received Your Hanna Order!",
      from_address: 'Hanna Andersson <info@e.o.hannaandersson.com>',
      snippet: 'Thank you for your purchase',
    })).toEqual({ quarantine: false, reason: null });
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

  it.each([
    ['publisher newsletter', 'Trump to Cut Some Tariffs on Canada', 'WSJ What\'s News <access@interactive.wsj.com>', 'Plus, the latest political news. View in browser'],
    ['retail newsletter sender', "It's been a while", 'Allivet <allivet@newsletter.allivet.com>', 'Save big on your next order. View in browser'],
    ['daily digest', 'Daily Digest: Grocery and Personal Care Party', 'Woot <store-news@woot.com>', 'Featured Deals: laptops and more'],
    ['reward promotion', 'Activate Rewards on items like shoes', 'Capital One Shopping <hello@capitaloneshopping.com>', 'Spend $350, Get $100 in Rewards'],
    ['property listing', 'New For Sale: 709 N Main St', 'Zillow <my-saved-home@mail.zillow.com>', 'More details inside'],
    ['editorial digest', 'Dynamic Duo', 'Morning Brew <crew@morningbrew.com>', 'View Online | Sign Up | Shop Newsletter Logo Presented by'],
    ['offer sender', 'The gold standard of suiting', 'Brooks Brothers <brooksbrothers@offers.brooksbrothers.com>', '2 suits starting at $1799'],
    ['future payment reminder', 'Your Payment Reminder', 'Card <billing@example.com>', 'Payment due next week'],
  ])('quarantines stored %s noise', (_label, subject, fromAddress, snippet) => {
    expect(assessStoredImport({ subject, fromAddress, snippet })).toMatchObject({ quarantine: true });
  });

  it('does not quarantine a payment receipt from an alerts sender', () => {
    expect(assessStoredImport({
      subject: 'Thank you for your payment',
      fromAddress: 'Duke Energy Alerts <payments@duke-energyalert.com>',
      snippet: 'Your payment was received. Amount paid: $196.79',
    })).toEqual({ quarantine: false, reason: null });
  });

  it('accepts stored database column names when replaying the policy', () => {
    expect(assessStoredImport({
      subject: 'The Post Most: today in politics',
      from_address: 'The Washington Post <info@nl.mail.washingtonpost.com>',
      snippet: 'Plus: today\'s stories',
    })).toMatchObject({ quarantine: true, reason: 'publisher_content' });
  });
});
