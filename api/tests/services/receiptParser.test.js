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

  it('normalizes richer receipt totals and item metadata', () => {
    const result = cleanParsedReceipt({
      merchant: 'Market',
      amount: 12.84,
      date: '2026-03-21',
      currency: 'usd',
      subtotal: 12,
      tax: 0.84,
      tip: null,
      fees: null,
      discounts: 2,
      transaction_id: 'TX-1042',
      purchase_time: '14:35',
      items: [{
        description: 'Sparkling water',
        amount: 12,
        quantity: 2,
        unit_price: 6,
        item_type: 'product',
        brand: 'Acme',
        product_size: '12 oz',
      }],
      uncertain_fields: [],
    }, '2026-03-21');

    expect(result).toMatchObject({
      currency: 'USD',
      subtotal: 12,
      tax: 0.84,
      transaction_id: 'TX-1042',
      purchase_time: '14:35',
      receipt_validation: {
        total_components_match: true,
        item_sum_matches_subtotal: true,
      },
    });
    expect(result.items[0]).toMatchObject({ quantity: 2, unit_price: 6, brand: 'Acme' });
  });

  it('normalizes all-caps receipt item names while preserving raw OCR text', () => {
    const result = cleanParsedReceipt({
      merchant: 'Market',
      amount: 3.99,
      date: '2026-03-21',
      items: [{ description: 'AVOCADOS', amount: 3.99, item_type: 'product' }],
    }, '2026-03-21');

    expect(result.items[0]).toMatchObject({
      description: 'Avocados',
      raw_description: 'AVOCADOS',
    });
  });

  it('marks the amount for review when printed totals do not reconcile', () => {
    const result = cleanParsedReceipt({
      merchant: 'Market',
      amount: 20,
      date: '2026-03-21',
      subtotal: 12,
      tax: 0.84,
      items: [{ description: 'Groceries', amount: 12, item_type: 'product' }],
    }, '2026-03-21');

    expect(result.receipt_validation.issues).toContain('total_components_mismatch');
    expect(result.review_fields).toContain('amount');
    expect(result.review_fields).toContain('receipt totals');
    expect(result.field_confidence.amount).toBe('medium');
  });

  it('keeps summary, payment, tax, and discount rows out of product items', () => {
    const result = cleanParsedReceipt({
      merchant: 'Market',
      amount: 10.8,
      date: '2026-03-21',
      subtotal: 10,
      tax: 0.8,
      items: [
        { description: 'Milk', amount: 4, item_type: 'product' },
        { description: 'Bread', amount: 6 },
        { description: 'Subtotal', amount: 10, item_type: '' },
        { description: 'Sales Tax', amount: 0.8, item_type: '' },
        { description: 'Visa Payment', amount: 10.8, item_type: 'summary' },
        { description: 'Coupon Savings', amount: -2, item_type: 'discount' },
      ],
      uncertain_fields: [],
    }, '2026-03-21');

    expect(result.items.map((item) => item.description)).toEqual(['Milk', 'Bread']);
    expect(result.receipt_validation).toMatchObject({
      product_item_count: 2,
      unpriced_item_count: 0,
      item_math_mismatch_count: 0,
      item_sum_matches_subtotal: true,
    });
  });

  it('flags inconsistent quantity math without treating unit price as the line total', () => {
    const result = cleanParsedReceipt({
      merchant: 'Market',
      amount: 7,
      date: '2026-03-21',
      subtotal: 7,
      items: [{
        description: 'Sparkling water',
        amount: 7,
        quantity: 3,
        unit_price: 2,
        item_type: 'product',
      }],
      uncertain_fields: [],
    }, '2026-03-21');

    expect(result.items[0].amount).toBe(7);
    expect(result.items[0].extraction_confidence).toBe('low');
    expect(result.receipt_validation.issues).toContain('item_math_mismatch');
    expect(result.review_fields).toContain('items');
  });

  it('does not claim an item sum mismatch when prices are incomplete', () => {
    const result = cleanParsedReceipt({
      merchant: 'Market',
      amount: 10.8,
      date: '2026-03-21',
      subtotal: 10,
      tax: 0.8,
      items: [
        { description: 'Milk', amount: 4 },
        { description: 'Bread', amount: 0 },
      ],
      uncertain_fields: [],
    }, '2026-03-21');

    expect(result.receipt_validation.item_sum_matches_subtotal).toBeNull();
    expect(result.receipt_validation.issues).toContain('item_amounts_incomplete');
    expect(result.receipt_validation.issues).not.toContain('item_sum_mismatch');
  });

  it('accepts a printed receipt-wide discount between product rows and subtotal', () => {
    const result = cleanParsedReceipt({
      merchant: 'Market',
      amount: 11.88,
      date: '2026-03-21',
      subtotal: 11,
      tax: 0.88,
      discounts: -1,
      items: [
        { description: 'Sparkling water', amount: 6.5 },
        { description: 'Bananas', amount: 1.5 },
        { description: 'Bread', amount: 4 },
      ],
      uncertain_fields: [],
    }, '2026-03-21');

    expect(result.discounts).toBe(1);
    expect(result.receipt_validation.item_sum_matches_subtotal).toBe(true);
    expect(result.receipt_validation.issues).not.toContain('item_sum_mismatch');
  });

  it('marks long receipt item extraction as incomplete', () => {
    const result = cleanParsedReceipt({
      merchant: 'Market',
      amount: 120,
      date: '2026-03-21',
      items: Array.from({ length: 30 }, (_, index) => ({
        description: `Item ${index + 1}`,
        amount: 4,
      })),
      items_truncated: true,
      visible_item_count: 37,
      uncertain_fields: [],
    }, '2026-03-21');

    expect(result.items).toHaveLength(30);
    expect(result.items_truncated).toBe(true);
    expect(result.visible_item_count).toBe(37);
    expect(result.review_fields).toContain('items');
    expect(result.receipt_validation).toMatchObject({
      items_truncated: true,
      visible_item_count: 37,
      extracted_item_count: 30,
      item_sum_matches_subtotal: null,
    });
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

  it('supports primary-only receipt parsing for single-retry routing', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockClear();
    instance.messages.create.mockResolvedValueOnce({
      model: 'claude-haiku-4-5-20251001',
      stop_reason: 'end_turn',
      usage: { input_tokens: 900, output_tokens: 120 },
      content: [{
        text: '{"merchant":"Whole Foods","amount":19.84,"date":"2026-04-27","notes":null,"items":[{"description":"Lasagne","amount":5.37}]}'
      }]
    });

    const result = await parseReceiptDetailed('fakebase64data', '2026-04-27', { passMode: 'primary_only' });

    expect(result.parsed.amount).toBe(19.84);
    expect(result.diagnostics.pass_mode).toBe('primary_only');
    expect(result.diagnostics.model_call_count).toBe(1);
    expect(result.diagnostics.model_input_tokens).toBe(900);
    expect(result.diagnostics.model_output_tokens).toBe(120);
    expect(instance.messages.create).toHaveBeenCalledTimes(1);
    expect(instance.messages.create.mock.calls[0][0]).toMatchObject({
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            properties: {
              payment_method: { type: ['string', 'null'] },
              items: {
                items: {
                  properties: {
                    item_type: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    });
    const schema = instance.messages.create.mock.calls[0][0].output_config.format.schema;
    expect(schema.properties.payment_method.enum).toBeUndefined();
    expect(schema.properties.items.items.properties.item_type.enum).toContain('');
    expect(schema.properties.uncertain_fields.items.enum).toContain('subtotal');
    expect(instance.messages.create.mock.calls[0][0].max_tokens).toBe(3200);
    expect(schema.required).toEqual(expect.arrayContaining(Object.keys(schema.properties)));
    expect(schema.properties.items.items.required).toEqual(
      expect.arrayContaining(Object.keys(schema.properties.items.items.properties))
    );
  });

  it('retries without structured output when Claude rejects the schema', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockClear();
    const schemaError = Object.assign(
      new Error("400 output_config.format.schema: Invalid schema: Enum value 'cash' does not match declared type"),
      { status: 400 }
    );
    instance.messages.create
      .mockRejectedValueOnce(schemaError)
      .mockResolvedValueOnce({
        model: 'claude-haiku-4-5-20251001',
        content: [{
          text: '{"merchant":"Aldi","amount":18.72,"date":"2026-04-27","notes":null,"items":null}'
        }],
      });

    const result = await parseReceiptDetailed('fakebase64data', '2026-04-27', { passMode: 'primary_only' });

    expect(result.parsed.merchant).toBe('Aldi');
    expect(result.diagnostics.structured_output_fallback_used).toBe(true);
    expect(instance.messages.create).toHaveBeenCalledTimes(2);
    expect(instance.messages.create.mock.calls[0][0].output_config).toBeDefined();
    expect(instance.messages.create.mock.calls[1][0].output_config).toBeUndefined();
  });

  it('supports fallback-only receipt parsing as the second retry strategy', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockClear();
    instance.messages.create.mockResolvedValueOnce({
      content: [{
        text: '{"merchant":"Whole Foods","amount":19.84,"date":"2026-04-27","notes":null,"items":[{"description":"Lasagne","amount":5.37}]}'
      }]
    });

    const result = await parseReceiptDetailed('fakebase64data', '2026-04-27', { passMode: 'fallback_only' });

    expect(result.parsed.amount).toBe(19.84);
    expect(result.diagnostics.pass_mode).toBe('fallback_only');
    expect(result.diagnostics.model_call_count).toBe(1);
    expect(instance.messages.create).toHaveBeenCalledTimes(1);
    const schema = instance.messages.create.mock.calls[0][0].output_config.format.schema;
    expect(Object.keys(schema.properties.items.items.properties)).toEqual(['description', 'amount']);
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
    expect(result.field_confidence.date).toBe('low');
  });

  it('does not silently accept a future transaction date', () => {
    const result = cleanParsedReceipt({
      merchant: 'Target',
      amount: 28.5,
      date: '2027-03-21',
      items: [{ description: 'Shampoo', amount: 28.5 }],
    }, '2026-03-21');

    expect(result.date).toBe('2026-03-21');
    expect(result.review_fields).toContain('date');
    expect(result.field_confidence.date).toBe('low');
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

  it('classifies a grocery receipt family in diagnostics', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const instance = new Anthropic();
    instance.messages.create.mockResolvedValueOnce({
      content: [{
        text: '{"merchant":"Whole Foods","amount":19.84,"date":"2026-04-27","notes":null,"items":[{"description":"Organic feta crumbles","amount":4.99}]}'
      }]
    });

    const result = await parseReceiptDetailed('fakebase64data', '2026-04-27');

    expect(result.diagnostics.receipt_family).toBe('grocery_receipt');
    expect(result.diagnostics.receipt_family_confidence).toBe('high');
  });
});

describe('parseJsonWithRecovery', () => {
  it('extracts a valid object from surrounding prose', () => {
    const result = parseJsonWithRecovery('Receipt:\n{"merchant":"Aldi","amount":12.45}');
    expect(result.raw.merchant).toBe('Aldi');
    expect(result.parser_mode).toBe('extracted');
  });
});
