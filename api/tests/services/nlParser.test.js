const { parseExpense } = require('../../src/services/nlParser');

// Mock Claude SDK - singleton instance shared across all constructor calls
jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn().mockResolvedValue({
    content: [{
      text: JSON.stringify({
        merchant: 'Trader Joe\'s',
        amount: 242.50,
        date: '2026-03-20',
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

describe('parseExpense', () => {
  it('parses amount and merchant from simple NL input', async () => {
    const result = await parseExpense('242.50 trader joes', '2026-03-20');
    expect(result.merchant).toBe("Trader Joe's");
    expect(result.amount).toBe(242.50);
    expect(result.date).toBe('2026-03-20');
    expect(result.notes).toBeNull();
  });

  it('returns null for unparseable input', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockResolvedValueOnce({
      content: [{ text: 'null' }]
    });
    const result = await parseExpense('asdfjkl', '2026-03-20');
    expect(result).toBeNull();
  });

  it('returns null for empty input', async () => {
    const result = await parseExpense('', '2026-03-20');
    expect(result).toBeNull();
  });

  it('throws if Claude API call fails', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockRejectedValueOnce(new Error('API timeout'));
    await expect(parseExpense('lunch chipotle 14.50', '2026-03-20')).rejects.toThrow('API timeout');
  });
});
