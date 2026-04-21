const Category = require('../models/category');
const IngestAttemptLog = require('../models/ingestAttemptLog');
const { parseExpenseDetailed } = require('./nlParser');
const { parseReceiptDetailed } = require('./receiptParser');
const { assignCategory } = require('./categoryAssigner');
const { searchPlace } = require('./mapkitService');
const { buildReceiptParsingContext } = require('./receiptContextService');

function truncateInputPreview(input, max = 180) {
  const text = `${input || ''}`.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function buildIngestFailure(source, failureReason) {
  const family = source === 'receipt' ? 'receipt' : 'nl';
  return {
    error: family === 'receipt' ? 'Could not parse receipt' : 'Could not parse expense',
    reason_code: failureReason || 'missing_required_fields',
  };
}

function buildParsedPaymentSnapshot(parsed = {}) {
  return {
    payment_method: parsed?.payment_method || null,
    card_label: parsed?.card_label || null,
    card_last4: parsed?.card_last4 || null,
  };
}

function shouldRetryReceiptWithContext(parsedResult, merchantHint = null) {
  if (!parsedResult) return false;
  if (!parsedResult.parsed) {
    return Boolean(merchantHint)
      && !['invalid_model_json', 'truncated_model_output', 'empty_model_response'].includes(parsedResult.failureReason);
  }
  const reviewFields = Array.isArray(parsedResult.parsed.review_fields) ? parsedResult.parsed.review_fields : [];
  return parsedResult.parsed.parse_status === 'partial'
    && reviewFields.some((field) => ['merchant', 'items'].includes(field));
}

function summarizeReceiptOutcome(parsedResult) {
  const parsed = parsedResult?.parsed || null;
  const reviewFields = Array.isArray(parsed?.review_fields) ? parsed.review_fields : [];
  return {
    parsed: Boolean(parsed),
    parse_status: parsed?.parse_status || 'failed',
    review_field_count: reviewFields.length,
    review_fields: reviewFields,
    failure_reason: parsedResult?.failureReason || null,
  };
}

function compareReceiptOutcomes(firstOutcome, finalOutcome) {
  const statusRank = { failed: 0, partial: 1, complete: 2 };
  const firstRank = statusRank[firstOutcome?.parse_status] ?? 0;
  const finalRank = statusRank[finalOutcome?.parse_status] ?? 0;
  const didStatusImprove = finalRank > firstRank;
  const didReviewCountImprove = finalOutcome?.parsed
    && firstOutcome?.parsed
    && Number.isFinite(firstOutcome.review_field_count)
    && Number.isFinite(finalOutcome.review_field_count)
    ? finalOutcome.review_field_count < firstOutcome.review_field_count
    : false;

  return {
    first_pass_status: firstOutcome?.parse_status || 'failed',
    first_pass_review_field_count: firstOutcome?.review_field_count ?? null,
    final_status: finalOutcome?.parse_status || 'failed',
    final_review_field_count: finalOutcome?.review_field_count ?? null,
    did_status_improve: didStatusImprove,
    did_review_count_improve: didReviewCountImprove,
    retry_was_unnecessary:
      finalOutcome?.parse_status === firstOutcome?.parse_status
      && (finalOutcome?.review_field_count ?? null) === (firstOutcome?.review_field_count ?? null),
  };
}

async function assignParsedCategory(user, parsed) {
  const categories = await Category.findByHousehold(user?.household_id);
  const assignment = await assignCategory({
    merchant: parsed.merchant,
    description: parsed.description,
    householdId: user?.household_id,
    categories,
  });
  const matchedCategory = categories.find((category) => category.id === assignment.category_id);
  return { categories, assignment, matchedCategory };
}

function buildCategoryResponseFields(assignment, matchedCategory) {
  return {
    category_id: assignment.category_id,
    category_name: matchedCategory?.name || null,
    category_source: assignment.source,
    category_confidence: assignment.confidence,
    category_reasoning: assignment.reasoning || null,
  };
}

async function parseExpenseInput({ userPromise, input, todayDate }) {
  let parsedResult;
  try {
    parsedResult = await parseExpenseDetailed(input, todayDate);
  } catch (err) {
    const user = await userPromise.catch(() => null);
    await IngestAttemptLog.create({
      userId: user?.id || null,
      source: 'nl',
      status: 'failed',
      failureReason: 'ai_unavailable',
      inputPreview: truncateInputPreview(input),
      metadata: {
        error: err.message,
        input_length: `${input || ''}`.trim().length,
      },
    });
    return { errorStatus: 503, errorBody: buildIngestFailure('nl', 'ai_unavailable') };
  }

  const user = await userPromise;
  const parsed = parsedResult?.parsed || null;
  if (!parsed) {
    const failure = buildIngestFailure('nl', parsedResult?.failureReason);
    await IngestAttemptLog.create({
      userId: user?.id || null,
      source: 'nl',
      status: 'failed',
      failureReason: failure.reason_code,
      inputPreview: truncateInputPreview(input),
      metadata: parsedResult?.diagnostics || { raw_present: Boolean(parsedResult?.raw) },
    });
    return { errorStatus: 422, errorBody: failure };
  }

  const { assignment, matchedCategory } = await assignParsedCategory(user, parsed);
  const attempt = await IngestAttemptLog.create({
    userId: user?.id || null,
    source: 'nl',
    status: parsed.parse_status === 'partial' ? 'partial' : 'parsed',
    inputPreview: truncateInputPreview(input),
    parseStatus: parsed.parse_status,
    reviewFields: parsed.review_fields,
    metadata: {
      ...(parsedResult?.diagnostics || {}),
      category_id: assignment.category_id,
      category_source: assignment.source,
      category_confidence: assignment.confidence,
    },
  });

  return {
    user,
    body: {
      ...parsed,
      ingest_attempt_id: attempt?.id || null,
      parsed_payment_snapshot: buildParsedPaymentSnapshot(parsed),
      ...buildCategoryResponseFields(assignment, matchedCategory),
    },
  };
}

async function scanReceiptInput({ user, imageBase64, todayDate }) {
  const scanStartedAt = Date.now();
  let parsedResult;
  let initialParseDurationMs = 0;
  try {
    const initialParseStartedAt = Date.now();
    parsedResult = await parseReceiptDetailed(imageBase64, todayDate);
    initialParseDurationMs = Date.now() - initialParseStartedAt;
  } catch (err) {
    await IngestAttemptLog.create({
      userId: user?.id || null,
      source: 'receipt',
      status: 'failed',
      failureReason: 'ai_unavailable',
      metadata: {
        image_size: imageBase64.length,
        error: err.message,
      },
    });
    return { errorStatus: 503, errorBody: buildIngestFailure('receipt', 'ai_unavailable') };
  }

  const firstPassOutcome = summarizeReceiptOutcome(parsedResult);
  let contextRetryAttempted = false;
  let contextLookupDurationMs = 0;
  let contextRetryDurationMs = 0;
  let contextRetrySkippedReason = null;
  const merchantHint = parsedResult?.parsed?.merchant || parsedResult?.raw?.merchant || null;

  if (user?.household_id && shouldRetryReceiptWithContext(parsedResult, merchantHint)) {
    const contextLookupStartedAt = Date.now();
    const context = await buildReceiptParsingContext({
      householdId: user.household_id,
      merchantHint,
    });
    contextLookupDurationMs = Date.now() - contextLookupStartedAt;

    const hasMerchantSpecificPriors = context.merchant_alias_count > 0 || context.merchant_item_count > 0;
    const hasUsefulFallbackPriors = Boolean(merchantHint) || firstPassOutcome.parse_status === 'partial';
    if (context.prior_count > 0 && (hasMerchantSpecificPriors || hasUsefulFallbackPriors)) {
      contextRetryAttempted = true;
      try {
        const contextRetryStartedAt = Date.now();
        const contextualResult = await parseReceiptDetailed(imageBase64, todayDate, { priors: context.priors });
        contextRetryDurationMs = Date.now() - contextRetryStartedAt;
        const contextualParsed = contextualResult?.parsed || null;
        const currentParsed = parsedResult?.parsed || null;
        const currentReviewCount = Array.isArray(currentParsed?.review_fields) ? currentParsed.review_fields.length : 99;
        const contextualReviewCount = Array.isArray(contextualParsed?.review_fields) ? contextualParsed.review_fields.length : 99;
        const isBetter = contextualParsed && (!currentParsed || contextualReviewCount <= currentReviewCount);

        if (isBetter) {
          parsedResult = {
            ...contextualResult,
            diagnostics: {
              ...(contextualResult.diagnostics || {}),
              context_retry_used: true,
              context_prior_count: context.prior_count,
              context_merchant_hint: context.merchant_hint,
            },
          };
        } else if (parsedResult?.diagnostics) {
          parsedResult.diagnostics = {
            ...parsedResult.diagnostics,
            context_retry_used: false,
            context_prior_count: context.prior_count,
            context_merchant_hint: context.merchant_hint,
          };
        }
      } catch {
        contextRetryDurationMs = 0;
        if (parsedResult?.diagnostics) {
          parsedResult.diagnostics = {
            ...parsedResult.diagnostics,
            context_retry_used: false,
            context_prior_count: context.prior_count,
            context_merchant_hint: context.merchant_hint,
          };
        }
      }
    } else {
      contextRetrySkippedReason = context.prior_count <= 0 ? 'no_priors' : 'low_value_priors';
    }
  } else {
    contextRetrySkippedReason = merchantHint ? 'not_eligible' : 'no_merchant_hint';
  }

  const finalOutcome = summarizeReceiptOutcome(parsedResult);
  const outcomeComparison = compareReceiptOutcomes(firstPassOutcome, finalOutcome);
  const totalScanDurationMs = Date.now() - scanStartedAt;
  const parsed = parsedResult?.parsed || null;

  if (!parsed) {
    const failure = buildIngestFailure('receipt', parsedResult?.failureReason);
    await IngestAttemptLog.create({
      userId: user?.id || null,
      source: 'receipt',
      status: 'failed',
      failureReason: failure.reason_code,
      metadata: {
        ...(parsedResult?.diagnostics || { image_size: imageBase64.length, raw_present: Boolean(parsedResult?.raw) }),
        ...outcomeComparison,
        context_retry_attempted: contextRetryAttempted,
        context_lookup_duration_ms: contextLookupDurationMs,
        context_retry_duration_ms: contextRetryDurationMs,
        initial_parse_duration_ms: initialParseDurationMs,
        total_scan_duration_ms: totalScanDurationMs,
        context_retry_skipped_reason: contextRetrySkippedReason,
      },
    });
    return { errorStatus: 422, errorBody: failure };
  }

  const { assignment, matchedCategory } = await assignParsedCategory(user, parsed);
  let matchedLocation = null;
  const locationQuery = [
    parsed.merchant,
    parsed.store_number ? `Store ${parsed.store_number}` : null,
    parsed.store_address,
  ].filter(Boolean).join(' ');

  if (locationQuery) {
    try {
      matchedLocation = await searchPlace(locationQuery);
    } catch {
      matchedLocation = null;
    }
  }

  const attempt = await IngestAttemptLog.create({
    userId: user?.id || null,
    source: 'receipt',
    status: parsed.parse_status === 'partial' ? 'partial' : 'parsed',
    parseStatus: parsed.parse_status,
    reviewFields: parsed.review_fields,
    metadata: {
      ...(parsedResult?.diagnostics || {}),
      ...outcomeComparison,
      context_retry_attempted: contextRetryAttempted,
      context_lookup_duration_ms: contextLookupDurationMs,
      context_retry_duration_ms: contextRetryDurationMs,
      initial_parse_duration_ms: initialParseDurationMs,
      total_scan_duration_ms: totalScanDurationMs,
      context_retry_skipped_reason: contextRetrySkippedReason,
      category_id: assignment.category_id,
      category_source: assignment.source,
      category_confidence: assignment.confidence,
    },
  });

  return {
    body: {
      ...parsed,
      ingest_attempt_id: attempt?.id || null,
      parsed_payment_snapshot: buildParsedPaymentSnapshot(parsed),
      source: 'camera',
      ...buildCategoryResponseFields(assignment, matchedCategory),
      place_name: matchedLocation?.place_name || parsed.merchant || null,
      address: matchedLocation?.address || parsed.store_address || null,
      mapkit_stable_id: matchedLocation?.mapkit_stable_id || null,
    },
  };
}

module.exports = {
  buildIngestFailure,
  parseExpenseInput,
  scanReceiptInput,
};
