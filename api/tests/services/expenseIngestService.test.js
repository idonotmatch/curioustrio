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

  it('reports image-model timeouts separately from unreadable receipts', async () => {
    const timeout = Object.assign(new Error('anthropic_image timed out'), { name: 'VendorTimeoutError' });
    parseReceiptDetailed.mockRejectedValueOnce(timeout);

    const result = await scanReceiptInput({
      user: { id: 'user-1', household_id: 'hh-1' },
      imageBase64: 'fakebase64',
      todayDate: '2026-10-07',
    });

    expect(result).toMatchObject({
      errorStatus: 503,
      errorBody: { error: 'Could not parse receipt', reason_code: 'ai_timeout' },
    });
    expect(IngestAttemptLog.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'receipt',
      status: 'failed',
      failureReason: 'ai_timeout',
    }));
  });

  it('passes the validated image media type to the image model', async () => {
    parseReceiptDetailed.mockResolvedValueOnce({
      parsed: {
        merchant: 'PNG Market',
        amount: 4,
        date: '2026-10-25',
        items: [],
        parse_status: 'complete',
        review_fields: [],
      },
      raw: { merchant: 'PNG Market' },
      diagnostics: { model_call_count: 1 },
    });

    await scanReceiptInput({
      user: { id: 'user-1', household_id: null },
      imageBase64: 'fakebase64',
      imageMediaType: 'image/png',
      todayDate: '2026-10-25',
    });

    expect(parseReceiptDetailed).toHaveBeenCalledWith('fakebase64', '2026-10-25', {
      passMode: 'primary_only',
      mediaType: 'image/png',
    });
  });

  it('records compact success metadata for parsed NL input', async () => {
    process.env.INGEST_SUCCESS_PARSED_SNAPSHOT_SAMPLE_RATE = '1';
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
    expect(payload.metadata.category_status).toBe('assigned');
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
    expect(result.body.category_status).toBe('deferred');
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
      category_status: 'assigned',
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
    expect(payload.metadata.model_call_count).toBe(2);
  });

  it('keeps usable first-pass data when an optional fallback attempt fails', async () => {
    process.env.PARSING_RECEIPT_SINGLE_RETRY_POLICY_MODE = 'single';
    parseReceiptDetailed
      .mockResolvedValueOnce({
        parsed: {
          merchant: 'Corner Market',
          amount: 12.5,
          date: '2026-10-25',
          items: [],
          parse_status: 'partial',
          review_fields: ['items'],
        },
        raw: { merchant: 'Corner Market' },
        diagnostics: { model_call_count: 1, receipt_family: 'grocery_receipt' },
      })
      .mockRejectedValueOnce(Object.assign(new Error('anthropic_image timed out'), { name: 'VendorTimeoutError' }));

    const result = await scanReceiptInput({
      user: { id: 'user-1', household_id: null },
      imageBase64: 'fakebase64',
      todayDate: '2026-10-25',
    });

    expect(result.errorStatus).toBeUndefined();
    expect(result.body).toMatchObject({ merchant: 'Corner Market', amount: 12.5, parse_status: 'partial' });
    expect(IngestAttemptLog.create.mock.calls.at(-1)[0].metadata.retry_failure_reason).toBe('ai_timeout');
  });

  it('returns extracted receipt data when category enrichment is unavailable', async () => {
    parseReceiptDetailed.mockResolvedValueOnce({
      parsed: {
        merchant: 'Cafe',
        amount: 9.25,
        date: '2026-10-25',
        items: [],
        parse_status: 'complete',
        review_fields: [],
      },
      raw: { merchant: 'Cafe' },
      diagnostics: { model_call_count: 1 },
    });
    Category.findByHousehold.mockRejectedValueOnce(new Error('database unavailable'));

    const result = await scanReceiptInput({
      user: { id: 'user-1', household_id: null },
      imageBase64: 'fakebase64',
      todayDate: '2026-10-25',
    });

    expect(result.body).toMatchObject({
      merchant: 'Cafe',
      amount: 9.25,
      category_id: null,
      category_source: 'deferred',
      category_status: 'deferred',
    });
  });

  it('returns extracted receipt data when telemetry storage fails', async () => {
    parseReceiptDetailed.mockResolvedValueOnce({
      parsed: {
        merchant: 'Bakery',
        amount: 6,
        date: '2026-10-25',
        items: [],
        parse_status: 'complete',
        review_fields: [],
      },
      raw: { merchant: 'Bakery' },
      diagnostics: { model_call_count: 1 },
    });
    IngestAttemptLog.create.mockRejectedValueOnce(new Error('telemetry unavailable'));

    const result = await scanReceiptInput({
      user: { id: 'user-1', household_id: null },
      imageBase64: 'fakebase64',
      todayDate: '2026-10-25',
    });

    expect(result.body).toMatchObject({ merchant: 'Bakery', amount: 6, ingest_attempt_id: null });
  });

  it('uses a contextual primary-only retry when the merchant is uncertain and priors are available', async () => {
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
          review_fields: ['merchant'],
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
    expect(payload.metadata.model_call_count).toBe(2);
  });

  it('keeps richer line items when a contextual retry improves fewer fields overall', async () => {
    process.env.PARSING_RECEIPT_SINGLE_RETRY_POLICY_MODE = 'single';
    parseReceiptDetailed
      .mockResolvedValueOnce({
        parsed: {
          merchant: 'Market',
          amount: 24,
          date: '2026-04-27',
          items: [
            { description: 'Milk', amount: 5, brand: 'Local Dairy', product_size: '1 gal' },
            { description: 'Eggs', amount: 6 },
            { description: 'Bread', amount: 4 },
          ],
          parse_status: 'partial',
          review_fields: ['merchant'],
        },
        raw: { merchant: 'Market' },
        diagnostics: { receipt_family: 'grocery_receipt', model_call_count: 1 },
      })
      .mockResolvedValueOnce({
        parsed: {
          merchant: 'Neighborhood Market',
          amount: 24,
          date: '2026-04-27',
          items: [],
          parse_status: 'complete',
          review_fields: [],
        },
        raw: { merchant: 'Neighborhood Market' },
        diagnostics: { receipt_family: 'grocery_receipt', model_call_count: 1 },
      });
    buildReceiptParsingContext.mockResolvedValue({
      priors: ['Neighborhood Market'],
      prior_count: 1,
      merchant_alias_count: 1,
      merchant_item_count: 0,
      merchant_hint: 'Market',
    });

    const result = await scanReceiptInput({
      user: { id: 'user-1', household_id: 'hh-1' },
      imageBase64: 'fakebase64',
      todayDate: '2026-04-27',
    });

    expect(result.body.items).toHaveLength(3);
    expect(result.body.merchant).toBe('Market');
  });

  it('uses its single retry to recover missing line items', async () => {
    process.env.PARSING_RECEIPT_SINGLE_RETRY_POLICY_MODE = 'single';
    parseReceiptDetailed
      .mockResolvedValueOnce({
        parsed: {
          merchant: 'Corner Cafe',
          amount: 12.5,
          date: '2026-04-27',
          items: null,
          parse_status: 'partial',
          review_fields: ['items'],
        },
        raw: { merchant: 'Corner Cafe' },
        diagnostics: { model_call_count: 1 },
      })
      .mockResolvedValueOnce({
        parsed: {
          merchant: 'Corner Cafe',
          amount: 12.5,
          date: '2026-04-27',
          items: [{ description: 'Latte', amount: 5.5 }],
          parse_status: 'complete',
          review_fields: [],
        },
        raw: { merchant: 'Corner Cafe' },
        diagnostics: { model_call_count: 1 },
      });
    buildReceiptParsingContext.mockResolvedValue({
      priors: [],
      prior_count: 0,
      merchant_alias_count: 0,
      merchant_item_count: 0,
      merchant_hint: 'Corner Cafe',
    });

    const result = await scanReceiptInput({
      user: { id: 'user-1', household_id: 'hh-1' },
      imageBase64: 'fakebase64',
      todayDate: '2026-04-27',
    });

    expect(parseReceiptDetailed).toHaveBeenCalledTimes(2);
    expect(buildReceiptParsingContext).toHaveBeenCalled();
    expect(result.body.items[0].description).toBe('Latte');
    const payload = IngestAttemptLog.create.mock.calls[0][0];
    expect(payload.metadata.retry_strategy).toBe('fallback_only');
    expect(payload.metadata.model_call_count).toBe(2);
  });

  it('does not retry an explicitly truncated receipt item list', async () => {
    process.env.PARSING_RECEIPT_SINGLE_RETRY_POLICY_MODE = 'single';
    parseReceiptDetailed.mockResolvedValueOnce({
      parsed: {
        merchant: 'Market',
        amount: 120.5,
        date: '2026-04-27',
        items: [{ description: 'Item one', amount: 5 }],
        items_truncated: true,
        parse_status: 'partial',
        review_fields: ['items'],
      },
      raw: { merchant: 'Market' },
      diagnostics: { model_call_count: 1 },
    });

    const result = await scanReceiptInput({
      user: { id: 'user-1', household_id: 'hh-1' },
      imageBase64: 'fakebase64',
      todayDate: '2026-04-27',
    });

    expect(parseReceiptDetailed).toHaveBeenCalledTimes(1);
    expect(buildReceiptParsingContext).not.toHaveBeenCalled();
    expect(result.body.items_truncated).toBe(true);
    const payload = IngestAttemptLog.create.mock.calls[0][0];
    expect(payload.metadata.retry_strategy).toBe('none');
    expect(payload.metadata.model_call_count).toBe(1);
  });
});
