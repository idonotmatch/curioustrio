const {
  parseExpense,
  cleanParsedExpense,
  parseJsonWithRecovery,
  normalizePersonPaymentFields,
} = require('../../src/services/nlParser');

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

  it('extracts explicit items syntax from NL input even when the model omits items', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockResolvedValueOnce({
      content: [{
        text: JSON.stringify({
          merchant: 'Target',
          description: 'groceries',
          amount: 42.18,
          date: '2026-04-11',
          notes: null,
          payment_method: null,
          card_label: null,
          items: null,
        }),
      }],
    });

    const result = await parseExpense(
      'target 42.18 items: bananas 3.20, yogurt 6.99, paper towels 12.49',
      '2026-04-11'
    );

    expect(result.items).toEqual([
      { description: 'bananas', amount: 3.2 },
      { description: 'yogurt', amount: 6.99 },
      { description: 'paper towels', amount: 12.49 },
    ]);
    expect(result.item_amount_sum).toBe(22.68);
  });

  it('recovers valid JSON when the model wraps it in prose', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockResolvedValueOnce({
      content: [{
        text: `Here is the parsed expense:\n{\n  "merchant": "Chipotle",\n  "description": "lunch",\n  "amount": 14.5,\n  "date": "2026-03-29",\n  "notes": null,\n  "payment_method": null,\n  "card_label": null,\n  "items": null\n}`,
      }],
    });

    const result = await parseExpense('lunch chipotle 14.50', '2026-03-29');
    expect(result.merchant).toBe('Chipotle');
    expect(result.amount).toBe(14.5);
  });

  it('repairs trailing commas in model JSON', () => {
    const result = parseJsonWithRecovery(`\`\`\`json
{
  "merchant": "Trader Joe's",
  "amount": 50,
}
\`\`\``);
    expect(result.parser_mode).toBe('direct');
    expect(result.raw.merchant).toBe("Trader Joe's");
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

  it('marks explicit items for review when item totals do not match the expense total', () => {
    const result = cleanParsedExpense({
      merchant: 'Whole Foods',
      description: 'groceries',
      amount: 31.4,
      date: '2026-04-11',
      notes: null,
      payment_method: null,
      card_label: null,
      items: [
        { description: 'salmon', amount: 18.5 },
        { description: 'asparagus', amount: 6.2 },
      ],
    }, '2026-04-11');

    expect(result.item_total_mismatch).toBe(true);
    expect(result.parse_status).toBe('partial');
    expect(result.review_fields).toContain('items');
    expect(result.field_confidence.items).toBe('low');
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

  it('promotes person-to-person payment names into merchant when the model leaves merchant null', () => {
    const result = cleanParsedExpense({
      merchant: null,
      description: 'payment to Heather for kids',
      amount: 112,
      date: '2026-04-10',
      notes: 'payment to Heather for kids',
      payment_method: null,
      card_label: null,
      items: null,
    }, '2026-04-10');

    expect(result.merchant).toBe('Heather');
    expect(result.description).toBe('kids');
    expect(result.notes).toBe('payment to Heather for kids');
    expect(result.counterparty_type).toBe('person');
    expect(result.merchant_source).toBe('person_payment_promotion');
  });

  it('promotes venmo-style person payments into merchant names', () => {
    expect(normalizePersonPaymentFields({
      merchant: null,
      description: 'venmo sarah for dinner',
      notes: null,
    })).toEqual({
      merchant: 'Sarah',
      description: 'dinner',
      notes: 'venmo sarah for dinner',
      counterparty_type: 'person',
      merchant_source: 'person_payment_promotion',
    });
  });

  it('leaves ordinary description-only expenses alone', () => {
    expect(normalizePersonPaymentFields({
      merchant: null,
      description: 'lunch',
      notes: null,
    })).toEqual({
      merchant: null,
      description: 'lunch',
      notes: null,
      counterparty_type: null,
      merchant_source: null,
    });
  });
});
