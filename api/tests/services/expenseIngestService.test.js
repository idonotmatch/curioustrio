jest.mock('../../src/models/category');
jest.mock('../../src/models/ingestAttemptLog');
jest.mock('../../src/services/nlParser');
jest.mock('../../src/services/receiptParser');
jest.mock('../../src/services/categoryAssigner');
jest.mock('../../src/services/mapkitService');
jest.mock('../../src/services/receiptContextService');

const Category = require('../../src/models/category');
const IngestAttemptLog = require('../../src/models/ingestAttemptLog');
const { parseExpenseDetailed } = require('../../src/services/nlParser');
const { parseReceiptDetailed } = require('../../src/services/receiptParser');
const { assignCategory, shouldDeferInitialCategoryAssignment } = require('../../src/services/categoryAssigner');
const { searchPlace } = require('../../src/services/mapkitService');
const { buildReceiptParsingContext } = require('../../src/services/receiptContextService');
const {
  parseExpenseInput,
  scanReceiptInput,
} = require('../../src/services/expenseIngestService');

describe('expenseIngestService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    Category.findByHousehold.mockReset();
    IngestAttemptLog.create.mockReset();
    parseExpenseDetailed.mockReset();
    parseReceiptDetailed.mockReset();
    assignCategory.mockReset();
    shouldDeferInitialCategoryAssignment.mockReset();
    searchPlace.mockReset();
    buildReceiptParsingContext.mockReset();

    Category.findByHousehold.mockResolvedValue([{ id: 'cat-1', name: 'Groceries' }]);
    IngestAttemptLog.create.mockResolvedValue({ id: 'attempt-1' });
    shouldDeferInitialCategoryAssignment.mockReturnValue(false);
    assignCategory.mockResolvedValue({
      category_id: 'cat-1',
      source: 'heuristic',
      confidence: 2,
      reasoning: { strategy: 'heuristic' },
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('records compact success metadata for parsed NL input', async () => {
    parseExpenseDetailed.mockResolvedValue({
      parsed: {
        merchant: 'Amazon',
        description: null,
        amount: 34,
        date: '2026-05-01',
        notes: null,
        payment_method: null,
        card_label: null,
        items: null,
        parse_status: 'complete',
        review_fields: [],
      },
      diagnostics: {
        parser_mode: 'direct',
        model_call_count: 1,
      },
    });

    await parseExpenseInput({
      userPromise: Promise.resolve({ id: 'user-1', household_id: 'hh-1' }),
      input: 'amazon 34 yesterday',
      todayDate: '2026-05-02',
    });

    expect(IngestAttemptLog.create).toHaveBeenCalledTimes(1);
    const payload = IngestAttemptLog.create.mock.calls[0][0];
    expect(payload.metadata.metadata_size_bytes).toBeGreaterThan(0);
    expect(payload.metadata.parsed_snapshot).toMatchObject({
      merchant: 'Amazon',
      amount: 34,
      category_id: 'cat-1',
    });
    expect(payload.metadata.category_ai_fallback_used).toBe(false);
  });

  it('defers initial category assignment for low-signal description-only input', async () => {
    shouldDeferInitialCategoryAssignment.mockReturnValue(true);
    parseExpenseDetailed.mockResolvedValue({
      parsed: {
        merchant: null,
        description: 'coffee',
        amount: 5,
        date: '2026-05-02',
        notes: null,
        payment_method: null,
        card_label: null,
        items: null,
        parse_status: 'complete',
        review_fields: [],
      },
      diagnostics: {
        parser_mode: 'deterministic_fast_path',
        model_call_count: 0,
      },
    });

    const result = await parseExpenseInput({
      userPromise: Promise.resolve({ id: 'user-1', household_id: 'hh-1' }),
      input: 'coffee 5',
      todayDate: '2026-05-02',
    });

    expect(Category.findByHousehold).not.toHaveBeenCalled();
    expect(assignCategory).not.toHaveBeenCalled();
    expect(result.body.category_id).toBeNull();
    expect(result.body.category_source).toBe('deferred');
    const payload = IngestAttemptLog.create.mock.calls[0][0];
    expect(payload.metadata.category_ai_fallback_skipped).toBe(true);
    expect(payload.metadata.category_fallback_reason).toBe('insufficient_specificity');
  });

  it('does not block scan response on place lookup when async enrichment is enabled', async () => {
    process.env.PARSING_ASYNC_PLACE_ENRICHMENT = 'true';
    parseReceiptDetailed.mockResolvedValue({
      parsed: {
        merchant: 'Whole Foods',
        amount: 19.84,
        date: '2026-04-27',
        store_address: '123 Main St',
        store_number: '104',
        payment_method: null,
        card_label: null,
        card_last4: null,
        items: [{ description: 'Lasagne', amount: 5.37 }],
        parse_status: 'complete',
        review_fields: [],
      },
      diagnostics: {
        receipt_family: 'grocery_receipt',
        model_call_count: 1,
      },
      raw: { merchant: 'Whole Foods' },
    });

    const result = await scanReceiptInput({
      user: { id: 'user-1', household_id: null },
      imageBase64: 'fakebase64',
      todayDate: '2026-04-27',
    });

    expect(searchPlace).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({
      place_name: 'Whole Foods',
      address: '123 Main St',
      location_status: 'deferred',
    });
    const payload = IngestAttemptLog.create.mock.calls[0][0];
    expect(payload.metadata.location_enrichment_status).toBe('deferred');
    expect(payload.metadata.place_lookup_attempted).toBe(false);
  });

  it('uses the single-retry receipt policy with a fallback-only second pass', async () => {
    process.env.PARSING_RECEIPT_SINGLE_RETRY_POLICY_MODE = 'single';
    parseReceiptDetailed
      .mockResolvedValueOnce({
        parsed: null,
        failureReason: 'missing_total',
        raw: { merchant: 'Whole Foods' },
        diagnostics: {
          receipt_family: 'grocery_receipt',
          model_call_count: 1,
        },
      })
      .mockResolvedValueOnce({
        parsed: {
          merchant: 'Whole Foods',
          amount: 19.84,
          date: '2026-04-27',
          store_address: '123 Main St',
          items: [{ description: 'Lasagne', amount: 5.37 }],
          payment_method: null,
          card_label: null,
          card_last4: null,
          parse_status: 'complete',
          review_fields: [],
        },
        raw: { merchant: 'Whole Foods' },
        diagnostics: {
          receipt_family: 'grocery_receipt',
          model_call_count: 1,
        },
      });

    const result = await scanReceiptInput({
      user: { id: 'user-1', household_id: null },
      imageBase64: 'fakebase64',
      todayDate: '2026-04-27',
    });

    expect(parseReceiptDetailed).toHaveBeenNthCalledWith(1, 'fakebase64', '2026-04-27', {
      passMode: 'primary_only',
    });
    expect(parseReceiptDetailed).toHaveBeenNthCalledWith(2, 'fakebase64', '2026-04-27', {
      passMode: 'fallback_only',
      familyHint: { family: 'grocery_receipt' },
    });
    expect(result.body.amount).toBe(19.84);
    const payload = IngestAttemptLog.create.mock.calls[0][0];
    expect(payload.metadata.retry_strategy).toBe('fallback_only');
  });

  it('uses a contextual primary-only retry when priors are available', async () => {
    process.env.PARSING_RECEIPT_SINGLE_RETRY_POLICY_MODE = 'single';
    parseReceiptDetailed
      .mockResolvedValueOnce({
        parsed: {
          merchant: 'Whole Foods',
          amount: 19.84,
          date: '2026-04-27',
          store_address: '123 Main St',
          items: [{ description: 'Unknown item', amount: null }],
          payment_method: null,
          card_label: null,
          card_last4: null,
          parse_status: 'partial',
          review_fields: ['items'],
        },
        raw: { merchant: 'Whole Foods' },
        diagnostics: {
          receipt_family: 'grocery_receipt',
          model_call_count: 1,
        },
      })
      .mockResolvedValueOnce({
        parsed: {
          merchant: 'Whole Foods',
          amount: 19.84,
          date: '2026-04-27',
          store_address: '123 Main St',
          items: [{ description: 'Organic feta crumbles', amount: 4.99 }],
          payment_method: null,
          card_label: null,
          card_last4: null,
          parse_status: 'complete',
          review_fields: [],
        },
        raw: { merchant: 'Whole Foods' },
        diagnostics: {
          receipt_family: 'grocery_receipt',
          model_call_count: 1,
        },
      });
    buildReceiptParsingContext.mockResolvedValue({
      priors: ['Organic feta crumbles · at Whole Foods · 2x · $4.99'],
      prior_count: 1,
      merchant_alias_count: 1,
      merchant_item_count: 1,
      merchant_hint: 'Whole Foods',
    });

    const result = await scanReceiptInput({
      user: { id: 'user-1', household_id: 'hh-1' },
      imageBase64: 'fakebase64',
      todayDate: '2026-04-27',
    });

    expect(buildReceiptParsingContext).toHaveBeenCalled();
    expect(parseReceiptDetailed).toHaveBeenNthCalledWith(2, 'fakebase64', '2026-04-27', {
      priors: ['Organic feta crumbles · at Whole Foods · 2x · $4.99'],
      passMode: 'primary_only',
      familyHint: { family: 'grocery_receipt' },
    });
    expect(result.body.items[0].description).toBe('Organic feta crumbles');
    const payload = IngestAttemptLog.create.mock.calls[0][0];
    expect(payload.metadata.retry_strategy).toBe('contextual_primary_only');
    expect(payload.metadata.context_retry_attempted).toBe(true);
  });
});
