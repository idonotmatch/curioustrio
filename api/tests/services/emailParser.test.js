jest.mock('../../src/services/ai', () => ({
  complete: jest.fn(),
  completeWithImage: jest.fn(),
}));

const { complete } = require('../../src/services/ai');
const { parseEmailExpense } = require('../../src/services/emailParser');

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
    expect(calledWith.messages[0].content.length).toBeLessThan(4000);
  });
});
