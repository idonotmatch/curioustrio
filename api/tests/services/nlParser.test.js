const { parseExpense, cleanParsedExpense } = require('../../src/services/nlParser');

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

describe('nlParser system prompt', () => {
  it('system prompt documents the items field', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/services/nlParser.js'),
      'utf8'
    );
    expect(src).toContain('items');
  });
});

describe('parseExpense', () => {
  it('parses amount and merchant from simple NL input', async () => {
    const result = await parseExpense('242.50 trader joes', '2026-03-20');
    expect(result.merchant).toBe("Trader Joe's");
    expect(result.amount).toBe(242.50);
    expect(result.date).toBe('2026-03-20');
    expect(result.notes).toBeNull();
    expect(result.parse_status).toBe('complete');
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

  it('extracts items, merchant, and card_label from a rich input string', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockResolvedValueOnce({
      content: [{
        text: JSON.stringify({
          merchant: 'Nordstrom',
          description: null,
          amount: 125,
          date: '2026-03-29',
          notes: null,
          payment_method: 'credit',
          card_label: 'amex platinum',
          items: [{ description: 'Nike running shoes', amount: 125 }],
        }),
      }],
    });

    const result = await parseExpense('125 nike running shoes from nordstrom using amex platinum', '2026-03-29');
    expect(result.merchant).toBe('Nordstrom');
    expect(result.payment_method).toBe('credit');
    expect(result.card_label).toBe('amex platinum');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].description).toBe('Nike running shoes');
  });

  it('defaults missing date to today and marks parse as partial', () => {
    const result = cleanParsedExpense({
      merchant: null,
      description: 'coffee',
      amount: 5,
      date: null,
      notes: null,
      payment_method: null,
      card_label: null,
      items: null,
    }, '2026-03-20');

    expect(result.date).toBe('2026-03-20');
    expect(result.parse_status).toBe('partial');
    expect(result.review_fields).toContain('date');
    expect(result.field_confidence.date).toBe('medium');
  });

  it('returns null when amount is missing', () => {
    const result = cleanParsedExpense({
      merchant: 'Trader Joe\'s',
      description: null,
      amount: null,
      date: '2026-03-20',
      notes: null,
      payment_method: null,
      card_label: null,
      items: null,
    }, '2026-03-20');

    expect(result).toBeNull();
  });

  it('returns null when merchant and description are both missing', () => {
    const result = cleanParsedExpense({
      merchant: null,
      description: null,
      amount: 14,
      date: '2026-03-20',
      notes: null,
      payment_method: null,
      card_label: null,
      items: null,
    }, '2026-03-20');

    expect(result).toBeNull();
  });
});
