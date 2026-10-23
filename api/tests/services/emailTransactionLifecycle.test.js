const {
  normalizeExternalId,
  extractEmailTransactionLifecycle,
  isNonFinancialLifecycleEvent,
  shouldReuseLifecycleExpense,
} = require('../../src/services/emailTransactionLifecycle');

describe('emailTransactionLifecycle', () => {
  it('normalizes order references without collapsing distinct orders', () => {
    expect(normalizeExternalId(' #ab 123/4 ')).toBe('AB-123-4');
    expect(normalizeExternalId('2026-10-22')).toBeNull();
  });

  it('extracts a purchase confirmation and its strong order identity', () => {
    expect(extractEmailTransactionLifecycle({
      subject: 'Order confirmation',
      body: 'Order #RT-270233\nOrder total $107.95\nYour items will be shipped soon.',
      classification: { disposition: 'expense' },
      threadId: 'thread-9',
    })).toEqual({
      gmailThreadId: 'thread-9',
      externalOrderId: 'RT-270233',
      externalTransactionId: null,
      eventType: 'purchase_confirmation',
    });
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
