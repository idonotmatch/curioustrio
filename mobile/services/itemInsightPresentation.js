function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `$${Number(value).toFixed(2)}`;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${Math.abs(Number(value)).toFixed(0)}%`;
}

export function getItemInsightEvidence(metadata = {}, history = null) {
  const count = Number(metadata.evidence_count ?? history?.occurrence_count ?? 0);
  const confidence = `${metadata.identity_confidence || metadata.confidence || history?.identity_confidence || 'medium'}`;
  const strong = confidence === 'high' && count >= 3;
  const label = strong ? 'Strong evidence' : (count >= 3 ? 'Repeated pattern' : 'Directional');
  const source = metadata.confidence_reason
    || (confidence === 'high' ? 'Stable item matches' : 'Normalized item matches');
  return {
    label,
    detail: count > 0 ? `${count} supporting purchases - ${source}` : source,
  };
}

export function getItemInsightSummary(insightType, metadata = {}, history = null, fallbackBody = '') {
  const itemName = metadata.item_name || history?.item_name || 'This item';
  const latestPurchase = history?.purchases?.[history.purchases.length - 1] || null;
  const latestMerchant = metadata.latest_merchant || latestPurchase?.merchant || 'your usual merchant';
  const cheapestMerchant = metadata.cheaper_merchant || null;
  const pricierMerchant = metadata.pricier_merchant || null;
  const deltaPercent = formatPercent(metadata.delta_percent);
  const baseline = metadata.baseline_amount ?? history?.prior_median_amount ?? history?.median_amount;
  const comparisonLabel = metadata.comparison_type === 'unit_price' ? 'unit-price' : 'price';

  switch (`${insightType || ''}`) {
    case 'item_recent_price_jump':
      return {
        whatChanged: fallbackBody || `${itemName} came in above its prior price baseline.`,
        whyItMatters: `${latestMerchant} was about ${deltaPercent} above the previous ${metadata.baseline_purchase_count || 'few'} purchases${baseline != null ? ` (${formatCurrency(baseline)} ${comparisonLabel})` : ''}.`,
        nextStep: 'Check the latest source purchase. Correct the item or amount if it is wrong; otherwise watch the next purchase before treating this as a lasting increase.',
      };
    case 'item_merchant_variance':
    case 'item_staple_merchant_opportunity':
      return {
        whatChanged: fallbackBody || `${itemName} has a repeatable merchant price difference.`,
        whyItMatters: cheapestMerchant && pricierMerchant
          ? `${cheapestMerchant} has been about ${deltaPercent} lower than ${pricierMerchant} across ${metadata.merchant_evidence_count || 'multiple'} comparable purchases.`
          : 'Repeated purchases show a meaningful difference between merchants.',
        nextStep: 'Compare the sample counts below before changing stores. Open any purchase that looks mismatched or unusually priced.',
      };
    case 'item_repurchase_accelerating':
      return {
        whatChanged: fallbackBody || `${itemName} returned sooner than its usual rhythm.`,
        whyItMatters: `The latest gap was ${metadata.latest_gap_days || '-'} days versus a usual gap of about ${metadata.average_gap_days || history?.average_gap_days || '-'} days.`,
        nextStep: 'Review the dates below to see whether this is a real usage change or a one-off stock-up or duplicate.',
      };
    case 'item_pattern_lapsed':
      return {
        whatChanged: fallbackBody || `${itemName} has not appeared on its usual schedule.`,
        whyItMatters: `It has been ${metadata.days_since_last_purchase || '-'} days since the last purchase, compared with a usual gap of about ${metadata.average_gap_days || history?.average_gap_days || '-'} days.`,
        nextStep: 'Decide whether the routine ended, the product changed, or a recent purchase was matched to a different item. Open a source purchase to correct the history.',
      };
    case 'item_staple_emerging':
      return {
        whatChanged: fallbackBody || `${itemName} is becoming a repeat purchase.`,
        whyItMatters: `It has appeared ${metadata.occurrence_count || history?.occurrence_count || '-'} times, about every ${metadata.average_gap_days || history?.average_gap_days || '-'} days.`,
        nextStep: 'Confirm the purchases belong together, then consider whether this routine should be part of your normal plan.',
      };
    case 'recurring_price_spike':
      return {
        whatChanged: fallbackBody || `${itemName} came in above your usual price this time.`,
        whyItMatters: `${latestMerchant} was about ${deltaPercent} above your recent baseline${baseline != null ? ` of ${formatCurrency(baseline)}` : ''}.`,
        nextStep: 'Check whether this was a one-off high price or whether it is worth changing where or when you buy it.',
      };
    case 'buy_soon_better_price':
      return {
        whatChanged: fallbackBody || `${itemName} is currently available below your usual price.`,
        whyItMatters: metadata.merchant
          ? `${metadata.merchant} is running about ${formatPercent(metadata.discount_percent)} below your usual ${comparisonLabel}.`
          : 'A recent observation suggests a better-than-usual price for this item.',
        nextStep: 'If you need it soon, compare the observed price with the purchase history before buying.',
      };
    case 'recurring_repurchase_due':
      return {
        whatChanged: fallbackBody || `${itemName} looks close to its usual repurchase window.`,
        whyItMatters: `You typically buy this every ${metadata.average_gap_days || history?.average_gap_days || '-'} days.`,
        nextStep: 'Use the purchase history below to decide whether this still belongs in your routine or can wait.',
      };
    case 'recurring_restock_window':
      return {
        whatChanged: fallbackBody || `${itemName} could fit within the room left this period.`,
        whyItMatters: `You may have roughly ${formatCurrency(metadata.projected_headroom_amount)} of headroom, and this item often lands around ${formatCurrency(history?.median_amount)}.`,
        nextStep: 'If this is still a staple, decide intentionally whether to restock now or wait.',
      };
    case 'recurring_cost_pressure':
      return {
        whatChanged: fallbackBody || `${itemName} is part of a recurring pattern that is getting more expensive.`,
        whyItMatters: 'Small repeated price changes can add up meaningfully across a month.',
        nextStep: 'Review the merchant and purchase timing behind the increase before changing the routine.',
      };
    default:
      return {
        whatChanged: fallbackBody || `${itemName} stands out in your purchase history.`,
        whyItMatters: 'This pattern is based on the item matches and source purchases shown below.',
        nextStep: 'Review the evidence and correct any source purchase that does not belong in the pattern.',
      };
  }
}
