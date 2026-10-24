const {
  pairEvidence,
  selectReconciliations,
} = require('../../scripts/reconcile-email-lifecycle-duplicates');

const base = {
  user_id: 'user-1',
  status: 'pending',
  merchant: 'Target',
  amount: 42.25,
  date: '2026-10-20',
  created_at: '2026-10-20T12:00:00Z',
  from_address: 'orders@oe.target.com',
  sender_root_domain: 'target.com',
  item_count: 0,
};

describe('email lifecycle reconciliation', () => {
  it('pairs a fulfillment update with its financial purchase across sender subdomains', () => {
    const confirmation = {
      ...base,
      expense_id: 'expense-1',
      log_id: 'log-1',
      subject: 'Order confirmation #T-100',
      email_event_type: 'purchase_confirmation',
      external_order_id: 'T-100',
    };
    const pickup = {
      ...base,
      expense_id: 'expense-2',
      log_id: 'log-2',
      created_at: '2026-10-21T12:00:00Z',
      from_address: 'updates@oe1.target.com',
      subject: 'Your order is ready for pickup',
      email_event_type: 'charge',
      external_order_id: 'T-100',
    };

    expect(pairEvidence(confirmation, pickup)).toMatchObject({ reason: 'exact_identity' });
    expect(selectReconciliations([confirmation, pickup])).toEqual([
      expect.objectContaining({
        duplicate_expense_id: 'expense-2',
        canonical_expense_id: 'expense-1',
      }),
    ]);
  });

  it('links a charge to a confirmation only when the evidence is complementary and tight', () => {
    const confirmation = {
      ...base,
      expense_id: 'expense-1',
      email_event_type: 'purchase_confirmation',
      subject: 'Order confirmation',
    };
    const charge = {
      ...base,
      expense_id: 'expense-2',
      email_event_type: 'charge',
      subject: 'Your payment was processed',
    };
    expect(pairEvidence(confirmation, charge)).toMatchObject({ reason: 'confirmation_charge_pair' });
    expect(pairEvidence(confirmation, { ...charge, amount: 55 })).toBeNull();
  });

  it('does not merge two ordinary same-price charges without a strong identity', () => {
    const first = { ...base, expense_id: 'expense-1', email_event_type: 'charge', subject: 'Receipt' };
    const second = { ...base, expense_id: 'expense-2', email_event_type: 'charge', subject: 'Receipt' };
    expect(pairEvidence(first, second)).toBeNull();
    expect(selectReconciliations([first, second])).toEqual([]);
  });

  it('does not reconcile two unknown messages merely because they share a thread', () => {
    const first = { ...base, expense_id: 'expense-1', gmail_thread_id: 'thread-1', subject: 'Appointment confirmation' };
    const second = { ...base, expense_id: 'expense-2', gmail_thread_id: 'thread-1', subject: 'Appointment confirmation' };
    expect(pairEvidence(first, second)).toBeNull();
  });

  it('matches a full order number to an ending-only fulfillment reference despite amount drift', () => {
    const receipt = {
      ...base,
      expense_id: 'expense-1',
      amount: 31.45,
      subject: "Thanks for shopping with us! Here's your order #:102003826480320.",
    };
    const pickup = {
      ...base,
      expense_id: 'expense-2',
      amount: 5,
      subject: 'Your Drive Up order ending in 0320 was picked up.',
    };
    expect(pairEvidence(receipt, pickup)).toMatchObject({ reason: 'exact_identity' });
  });

  it('reprocesses a standalone fulfillment update even when its confirmation is no longer pending', () => {
    const shipping = {
      ...base,
      expense_id: 'expense-shipping',
      log_id: 'log-shipping',
      subject: "We're getting your Autoship order ready",
      email_event_type: 'charge',
    };
    expect(selectReconciliations([shipping])).toEqual([
      expect.objectContaining({
        duplicate_expense_id: 'expense-shipping',
        canonical_expense_id: null,
        reason: 'nonfinancial_shipping_update',
        match_confidence: 'none',
      }),
    ]);
  });
});
