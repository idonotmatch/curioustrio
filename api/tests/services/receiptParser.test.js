const { parseReceipt } = require('../../src/services/receiptParser');

// Mock Claude SDK - singleton instance shared across all constructor calls
jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn().mockResolvedValue({
    content: [{
      text: JSON.stringify({
        merchant: 'Whole Foods',
        amount: 87.43,
        date: '2026-03-21',
        notes: null,
      })
    }]
  });

  const mockInstance = {
    messages: {
      create: mockCreate,
    }
  };

  const MockAnthropic = jest.fn().mockImplementation(() => mockInstance);
  return MockAnthropic;
});

describe('parseReceipt', () => {
  it('returns parsed {merchant, amount, date, notes} from receipt image', async () => {
    const fakeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
    const result = await parseReceipt(fakeBase64, '2026-03-21');
    expect(result.merchant).toBe('Whole Foods');
    expect(result.amount).toBe(87.43);
    expect(result.date).toBe('2026-03-21');
    expect(result.notes).toBeNull();
  });

  it('returns null when Claude returns "null"', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockResolvedValueOnce({
      content: [{ text: 'null' }]
    });
    const result = await parseReceipt('fakebase64data', '2026-03-21');
    expect(result).toBeNull();
  });

  it('returns null when Claude returns invalid JSON', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockResolvedValueOnce({
      content: [{ text: 'not valid json {{{' }]
    });
    const result = await parseReceipt('fakebase64data', '2026-03-21');
    expect(result).toBeNull();
  });

  it('throws when imageBase64 is empty string', async () => {
    await expect(parseReceipt('', '2026-03-21')).rejects.toThrow();
  });

  it('throws when imageBase64 is missing/null', async () => {
    await expect(parseReceipt(null, '2026-03-21')).rejects.toThrow();
  });

  it('throws when todayDate is invalid format', async () => {
    await expect(parseReceipt('fakebase64data', 'March 21, 2026')).rejects.toThrow();
  });

  it('handles empty content array safely (returns null)', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockResolvedValueOnce({
      content: []
    });
    const result = await parseReceipt('fakebase64data', '2026-03-21');
    expect(result).toBeNull();
  });
});
