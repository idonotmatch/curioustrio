const { parseReceipt, parseReceiptDetailed, cleanParsedReceipt, parseJsonWithRecovery } = require('../../src/services/receiptParser');

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
    expect(result.parse_status).toBe('partial');
    expect(result.review_fields).toContain('items');
  });

  it('preserves parsed store address and store number when present', () => {
    const result = cleanParsedReceipt({
      merchant: 'Trader Joe\'s',
      amount: 28.5,
      date: '2026-03-21',
      notes: null,
      store_address: '123 Main St, Brooklyn, NY 11201',
      store_number: '104',
      items: null,
    }, '2026-03-21');

    expect(result.store_address).toBe('123 Main St, Brooklyn, NY 11201');
    expect(result.store_number).toBe('104');
  });

  it('returns null when Claude returns "null"', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create
      .mockResolvedValueOnce({
        content: [{ text: 'null' }]
      })
      .mockResolvedValueOnce({
        content: [{ text: 'null' }]
      });
    const result = await parseReceipt('fakebase64data', '2026-03-21');
    expect(result).toBeNull();
  });

  it('returns null when Claude returns invalid JSON', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create
      .mockResolvedValueOnce({
        content: [{ text: 'not valid json {{{' }]
      })
      .mockResolvedValueOnce({
        content: [{ text: 'still not valid json {{{' }]
      });
    const result = await parseReceipt('fakebase64data', '2026-03-21');
    expect(result).toBeNull();
  });

  it('recovers when Claude wraps JSON with extra prose', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockResolvedValueOnce({
      content: [{
        text: 'Here is the receipt data:\n```json\n{"merchant":"Costco","amount":52.14,"date":"2026-03-21","notes":null,"items":null}\n```'
      }]
    });

    const result = await parseReceipt('fakebase64data', '2026-03-21');
    expect(result.merchant).toBe('Costco');
    expect(result.amount).toBe(52.14);
  });

  it('records raw text preview and extracted parser mode on recovered parse', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockResolvedValueOnce({
      content: [{
        text: 'Result:\n{"merchant":"Safeway","amount":41.02,"date":"2026-03-21","notes":null,"items":null,}'
      }]
    });

    const result = await parseReceiptDetailed('fakebase64data', '2026-03-21');
    expect(result.parsed.merchant).toBe('Safeway');
    expect(result.diagnostics.parser_mode).toBe('extracted');
    expect(result.diagnostics.raw_text_preview).toContain('Safeway');
  });

  it('falls back to a smaller schema when the primary parse is unusable', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create
      .mockResolvedValueOnce({
        content: [{ text: 'not valid json {{{' }]
      })
      .mockResolvedValueOnce({
        content: [{
          text: '{"merchant":"Kroger","amount":73.44,"date":"2026-03-21","notes":null,"items":[{"description":"Groceries","amount":73.44}]}'
        }]
      });

    const result = await parseReceiptDetailed('fakebase64data', '2026-03-21', {
      priors: ['Bananas · at Kroger · 6x · $1.99'],
    });
    expect(result.parsed.merchant).toBe('Kroger');
    expect(result.parsed.amount).toBe(73.44);
    expect(result.diagnostics.fallback_attempted).toBe(true);
    expect(result.diagnostics.fallback_succeeded).toBe(true);
    expect(result.diagnostics.context_prior_count).toBe(1);
  });

  it('keeps the original failure classification when fallback also fails', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create
      .mockResolvedValueOnce({
        content: [{ text: 'not valid json' }]
      })
      .mockResolvedValueOnce({
        content: [{ text: 'still not json' }]
      });

    const result = await parseReceiptDetailed('fakebase64data', '2026-03-21');
    expect(result.parsed).toBeNull();
    expect(result.failureReason).toBe('invalid_model_json');
    expect(result.diagnostics.fallback_attempted).toBe(true);
    expect(result.diagnostics.fallback_succeeded).toBe(false);
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

  it('marks missing date as partial and defaults to today', () => {
    const result = cleanParsedReceipt({
      merchant: 'Target',
      amount: 28.5,
      date: null,
      notes: null,
      items: null,
    }, '2026-03-21');

    expect(result.date).toBe('2026-03-21');
    expect(result.parse_status).toBe('partial');
    expect(result.review_fields).toEqual(expect.arrayContaining(['date', 'items']));
    expect(result.field_confidence.date).toBe('medium');
  });

  it('returns null when amount is missing even if other fields exist', () => {
    const result = cleanParsedReceipt({
      merchant: 'Target',
      amount: null,
      date: '2026-03-21',
      notes: null,
      items: null,
    }, '2026-03-21');

    expect(result).toBeNull();
  });
});

describe('parseJsonWithRecovery', () => {
  it('extracts a valid object from surrounding prose', () => {
    const result = parseJsonWithRecovery('Receipt:\n{"merchant":"Aldi","amount":12.45}');
    expect(result.raw.merchant).toBe('Aldi');
    expect(result.parser_mode).toBe('extracted');
  });
});
