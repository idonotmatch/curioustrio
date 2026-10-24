const {
  normalizeExternalId,
  buildMessageFingerprint,
  extractEmailTransactionLifecycle,
  isNonFinancialLifecycleEvent,
  scoreLifecycleCandidate,
  shouldReuseLifecycleExpense,
} = require('../../src/services/emailTransactionLifecycle');
const { extractSenderRootDomain } = require('../../src/services/gmailImportFingerprint');

describe('emailTransactionLifecycle', () => {
  it('normalizes order references without collapsing distinct orders', () => {
    expect(normalizeExternalId(' #ab 123/4 ')).toBe('AB-123-4');
    expect(normalizeExternalId('2026-10-22')).toBeNull();
  });

  it('extracts a purchase confirmation and its strong order identity', () => {
    expect(extractEmailTransactionLifecycle({
      subject: 'Order confirmation',
      body: 'Order #RT-270233\nOrder total $107.95\nYour items will be shipped soon.',
      fromAddress: 'orders@shop.example.com',
      senderRootDomain: 'example.com',
      classification: { disposition: 'expense' },
      threadId: 'thread-9',
    })).toEqual(expect.objectContaining({
      gmailThreadId: 'thread-9',
      externalOrderId: 'RT-270233',
      externalTransactionId: null,
      eventType: 'purchase_confirmation',
      purchaseIdentityKey: 'order:example.com:RT-270233',
    }));
  });

  it('does not mistake cancellation policy text for a cancellation event', () => {
    const lifecycle = extractEmailTransactionLifecycle({
      subject: 'Booking confirmation',
      body: 'Confirmation #HOTEL-5\nCancellation policy applies.\nTotal charged $220.00',
      classification: { disposition: 'expense' },
    });
    expect(lifecycle.eventType).toBe('charge');
  });

  it('recognizes shipping and cancellation as non-financial lifecycle events', () => {
    expect(isNonFinancialLifecycleEvent(extractEmailTransactionLifecycle({
      subject: 'Your order has shipped',
      body: 'Order #A-1',
    }).eventType)).toBe(true);
    expect(isNonFinancialLifecycleEvent(extractEmailTransactionLifecycle({
      subject: 'Order canceled',
      body: 'Order #A-2',
    }).eventType)).toBe(true);
  });

  it.each([
    ['Your order is on the way', 'Order #A-3'],
    ['We are getting your Autoship order ready', 'Order #A-4'],
    ['Your order is ready for pickup', 'Order ending in 0320'],
    ['Your order was picked up', 'Order ending in 0320'],
    ['Get ready for something special! Items from order #102003494797164 are about to ship.', ''],
    ['Part of your order arrives today! Order #102003494797164', ''],
    ['An update to your order #1RL2YSC', ''],
  ])('stops fulfillment event %s before expense creation', (subject, body) => {
    const lifecycle = extractEmailTransactionLifecycle({ subject, body });
    expect(lifecycle.eventType).toBe('shipping_update');
    expect(isNonFinancialLifecycleEvent(lifecycle.eventType)).toBe(true);
  });

  it('extracts abbreviated and ending-only order references', () => {
    expect(extractEmailTransactionLifecycle({
      subject: 'Confirmation for order [ABC-1234]',
    }).externalOrderId).toBe('ABC-1234');
    expect(extractEmailTransactionLifecycle({
      subject: 'Your order ending in 0320 was picked up',
    }).externalOrderId).toBe('ENDING-0320');
    expect(extractEmailTransactionLifecycle({
      subject: "Thanks for shopping with us! Here's your order #:102003826480320.",
    }).externalOrderId).toBe('102003826480320');
  });

  it.each([
    ["Thanks for shopping with us! Here's your order #:102003826480320."],
    ['Your order #1115156 is confirmed'],
  ])('recognizes merchant-specific receipt wording as a purchase confirmation', (subject) => {
    expect(extractEmailTransactionLifecycle({ subject }).eventType).toBe('purchase_confirmation');
  });

  it('uses root sender domains across merchant email subdomains', () => {
    expect(extractSenderRootDomain('Target <orders@oe.target.com>')).toBe('target.com');
    expect(extractSenderRootDomain('Target <orders@oe1.target.com>')).toBe('target.com');
    expect(extractSenderRootDomain('Orders <hello@shop.example.co.uk>')).toBe('example.co.uk');
  });

  it('creates stable fingerprints for the same message content', () => {
    const input = {
      subject: 'Your receipt',
      fromAddress: 'Shop <orders@shop.com>',
      body: 'Total $12.00 https://shop.com/order/123',
      snippet: 'Total $12.00',
    };
    expect(buildMessageFingerprint(input)).toBe(buildMessageFingerprint(input));
    expect(buildMessageFingerprint(input)).not.toBe(buildMessageFingerprint({ ...input, body: 'Total $14.00' }));
  });

  it('auto-links only strong complementary purchase events', () => {
    const candidate = {
      merchant: 'Black & White Coffee',
      amount: 43.86,
      date: '2026-10-20',
      sender_root_domain: 'blackwhiteroasters.com',
      email_event_type: 'purchase_confirmation',
      items: [],
    };
    expect(scoreLifecycleCandidate({
      merchant: 'Black & White Coffee',
      amount: 43.86,
      date: '2026-10-20T04:00:00.000Z',
      senderRootDomain: 'blackwhiteroasters.com',
      eventType: 'charge',
      items: [],
    }, candidate)).toMatchObject({ confidence: 'high' });

    expect(scoreLifecycleCandidate({
      merchant: 'Black & White Coffee',
      amount: 43.86,
      date: '2026-10-20',
      senderRootDomain: 'blackwhiteroasters.com',
      eventType: 'charge',
      items: [],
    }, { ...candidate, email_event_type: 'charge' })).toMatchObject({ confidence: 'medium' });
  });

  it('reuses the existing positive expense but keeps refunds separate', () => {
    const related = { expense_id: 'expense-1', match_key: 'order_id' };
    expect(shouldReuseLifecycleExpense('charge', related, { amount: 12, date: '2026-10-20' })).toBe(true);
    expect(shouldReuseLifecycleExpense('purchase_confirmation', related, { amount: 12, date: '2026-10-20' })).toBe(true);
    expect(shouldReuseLifecycleExpense('refund', related, { amount: -12, date: '2026-10-20' })).toBe(false);
  });

  it('requires amount and timing agreement before using Gmail thread as a fallback identity', () => {
    const related = {
      expense_id: 'expense-1',
      match_key: 'gmail_thread',
      amount: 12,
      date: '2026-10-20',
    };
    expect(shouldReuseLifecycleExpense('charge', related, { amount: 12, date: '2026-10-22' })).toBe(true);
    expect(shouldReuseLifecycleExpense('charge', related, { amount: 19, date: '2026-10-22' })).toBe(false);
    expect(shouldReuseLifecycleExpense('charge', related, { amount: 12, date: '2026-09-01' })).toBe(false);
  });
});
