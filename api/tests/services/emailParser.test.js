jest.mock('../../src/services/ai', () => ({
  complete: jest.fn(),
  completeWithImage: jest.fn(),
}));

const { complete } = require('../../src/services/ai');
const { parseEmailExpense, classifyEmailExpense, heuristicDisposition } = require('../../src/services/emailParser');

describe('emailParser', () => {
  beforeEach(() => complete.mockReset());

  it('returns parsed expense from receipt email', async () => {
    complete.mockResolvedValue('{"merchant":"Amazon","amount":29.99,"date":"2026-03-21","notes":"Order #123"}');
    const result = await parseEmailExpense('Your order total: $29.99', 'Order Confirmation', 'orders@amazon.com', '2026-03-21');
    expect(result).toEqual({ merchant: 'Amazon', amount: 29.99, date: '2026-03-21', notes: 'Order #123' });
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
});
