jest.mock('../../src/services/ai', () => ({
  complete: jest.fn(),
  completeWithImage: jest.fn(),
}));

const { complete } = require('../../src/services/ai');
const {
  parseEmailExpense,
  classifyEmailExpense,
  heuristicDisposition,
  selectRelevantEmailText,
  analyzeEmailSignals,
  classifyEmailModality,
  extractEmailLocationCandidate,
  clampExpenseDate,
} = require('../../src/services/emailParser');

describe('emailParser', () => {
  beforeEach(() => complete.mockReset());

  it('returns parsed expense from receipt email', async () => {
    complete.mockResolvedValue('{"merchant":"Amazon","amount":29.99,"date":"2026-03-21","notes":"Order #123"}');
    const result = await parseEmailExpense('Your order total: $29.99', 'Order Confirmation', 'orders@amazon.com', '2026-03-21');
    expect(result).toEqual({
      merchant: 'Amazon',
      amount: 29.99,
      date: '2026-03-21',
      notes: 'Order #123',
      payment_method: null,
      card_label: null,
      card_last4: null,
    });
  });

  it('returns null for non-receipt emails', async () => {
    complete.mockResolvedValue('null');
    const result = await parseEmailExpense('Hi, how are you?', 'Hey', 'friend@example.com', '2026-03-21');
    expect(result).toBeNull();
  });

  it('returns null on invalid JSON', async () => {
    complete.mockResolvedValue('not json');
    const result = await parseEmailExpense('body', 'subject', 'from@test.com', '2026-03-21');
    expect(result).toBeNull();
  });

  it('classifies obvious shipping-only emails without an LLM call', async () => {
    const result = await classifyEmailExpense(
      'Your package is out for delivery. Track your shipment here.',
      'Delivery update',
      'tracking@ups.com',
      '2026-03-21'
    );
    expect(result).toEqual({
      disposition: 'not_expense',
      merchant: null,
      reason: 'heuristic_skip',
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('classifies purchase emails with the classifier prompt', async () => {
    complete.mockResolvedValue('{"disposition":"expense","merchant":"Amazon","reason":"order receipt"}');
    const result = await classifyEmailExpense(
      'Order total: $29.99',
      'Amazon order',
      'orders@amazon.com',
      '2026-03-21'
    );
    expect(result).toEqual({
      disposition: 'expense',
      merchant: 'Amazon',
      reason: 'order receipt',
    });
  });

  it('heuristicDisposition only flags clear non-expense emails', () => {
    expect(heuristicDisposition('Delivery update', 'tracking@ups.com', 'Track your package')).toBe('not_expense');
    expect(heuristicDisposition('Order confirmation', 'orders@amazon.com', 'Order total: $20.00')).toBeNull();
  });

  it('treats transaction-like money signals as review-worthy even when the email is noisy', () => {
    const signals = analyzeEmailSignals(
      'Your booking is confirmed',
      'receipts@booking.com',
      'View in browser. Reservation details below. Total charged: $184.22. Manage preferences.'
    );
    expect(signals.strongMoneySignal).toBe(true);
    expect(signals.shouldSurfaceToReview).toBe(true);
    expect(heuristicDisposition(
      'Your booking is confirmed',
      'receipts@booking.com',
      'View in browser. Reservation details below. Total charged: $184.22. Manage preferences.'
    )).toBeNull();
  });

  it('treats Uber and Lyft senders as transactional when ride context is present', () => {
    const uberSignals = analyzeEmailSignals(
      'Your ride with Uber',
      'uber.us@uber.com',
      'Trip total: $18.42'
    );
    const lyftSignals = analyzeEmailSignals(
      'Thanks for riding with Lyft',
      'receipt@lyftmail.com',
      'Ride receipt total $24.18'
    );
    expect(uberSignals.senderLooksTransactional).toBe(true);
    expect(uberSignals.shouldSurfaceToReview).toBe(true);
    expect(lyftSignals.senderLooksTransactional).toBe(true);
    expect(lyftSignals.shouldSurfaceToReview).toBe(true);
  });

  it('throws when emailBody is empty', async () => {
    await expect(parseEmailExpense('', 'sub', 'from@test.com', '2026-03-21')).rejects.toThrow('emailBody is required');
  });

  it('throws when todayDate is invalid', async () => {
    await expect(parseEmailExpense('body', 'sub', 'from@test.com', 'bad-date')).rejects.toThrow('todayDate must be');
  });

  it('truncates very long email bodies', async () => {
    complete.mockResolvedValue('null');
    const longBody = 'x'.repeat(5000);
    await parseEmailExpense(longBody, 'sub', 'from@test.com', '2026-03-21');
    const calledWith = complete.mock.calls[0][0];
    expect(calledWith.messages[0].content.length).toBeLessThan(4600);
  });

  it('includes the snippet in relevant email text selection', () => {
    const result = selectRelevantEmailText('Body with order total $19.00', 'Snippet with merchant');
    expect(result.classifierText).toContain('Snippet with merchant');
    expect(result.extractionText).toContain('Snippet with merchant');
  });

  it('preserves line structure in extraction text for itemized emails', () => {
    const emailBody = `Order summary
Subtotal (4 items)
Protein Bars
Sparkling Water
Estimated shipping
Estimated tax
Estimated total
$22.00
$14.99
$8.49
$0.00
$1.20
$24.19`;
    const result = selectRelevantEmailText(emailBody, 'Estimated total $24.19');
    expect(result.extractionText).toContain('Protein Bars\nSparkling Water');
    expect(result.extractionText).toContain('Estimated total\n$22.00');
  });

  it('preserves bottom receipt totals when they appear later in the email', () => {
    const emailBody = `Thanks for your order
Marketing banner
Recommended items
Still shopping?
---
Order summary
Protein Bars
Sparkling Water
Shipping
Tax
Grand total
$14.99
$8.49
$0.00
$1.20
$24.68`;
    const result = selectRelevantEmailText(emailBody, 'Grand total $24.68');
    expect(result.classifierText).toContain('Grand total');
    expect(result.classifierText).toContain('$24.68');
    expect(result.extractionText).toContain('Grand total');
    expect(result.extractionText).toContain('$24.68');
  });

  it('keeps likely item rows alongside total lines in extraction text', () => {
    const emailBody = `Order summary
Nike running shoes
Water bottle
Discount
Estimated total
$122.24`;
    const result = selectRelevantEmailText(emailBody, 'Estimated total $122.24');
    expect(result.extractionText).toContain('Nike running shoes');
    expect(result.extractionText).toContain('Water bottle');
    expect(result.extractionText).toContain('Estimated total\n$122.24');
  });

  it('sends structured extraction text to the parser prompt', async () => {
    complete.mockResolvedValue('null');
    await parseEmailExpense(
      `Order summary
Protein Bars
Sparkling Water
Estimated total
$24.19`,
      'Order Confirmation',
      'orders@example.com',
      '2026-03-21'
    );
    const calledWith = complete.mock.calls[0][0];
    expect(calledWith.messages[0].content).toContain('Protein Bars\nSparkling Water');
    expect(calledWith.messages[0].content).toContain('Estimated total\n$24.19');
  });

  it('clamps future parsed dates to the latest allowed charge date', () => {
    expect(clampExpenseDate('2026-04-07', '2026-04-03')).toBe('2026-04-03');
    expect(clampExpenseDate('2026-04-01', '2026-04-03')).toBe('2026-04-01');
    expect(clampExpenseDate(null, '2026-04-03')).toBe('2026-04-03');
  });

  it('classifies in-person receipt emails separately from online orders', () => {
    expect(classifyEmailModality(
      'Your receipt from Trader Joe\'s',
      'receipts@traderjoes.com',
      'Thanks for shopping with us today. Store #104. 123 Main St, Brooklyn, NY 11201.'
    )).toBe('in_person');

    expect(classifyEmailModality(
      'Order confirmation',
      'orders@amazon.com',
      'Your order has been placed. Estimated delivery April 7. Track your package.'
    )).toBe('delivery');
  });

  it('extracts a candidate location from in-person receipt text', () => {
    expect(extractEmailLocationCandidate(
      'Your receipt from Trader Joe\'s',
      'receipts@traderjoes.com',
      'Store #104. 123 Main St, Brooklyn, NY 11201.'
    )).toEqual({
      address: '123 Main St, Brooklyn, NY 11201',
      city_state: 'Brooklyn, NY 11201',
      store_number: '104',
    });
  });
});
