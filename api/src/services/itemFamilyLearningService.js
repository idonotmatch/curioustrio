const crypto = require('crypto');
const ItemFamilyLearning = require('../models/itemFamilyLearning');
const {
  cleanItemDescription,
  isInsightEligibleItemIdentity,
  normalizeComparableDescription,
  normalizeItemDisplayName,
} = require('./itemNormalizer');
const { classifyItemInsightContext } = require('./itemInsightEligibility');
const { deriveItemFamilyIdentity } = require('./itemFamilyService');

const FAMILY_STOP_WORDS = new Set([
  'and', 'brand', 'each', 'fresh', 'market', 'organic', 'org', 'original', 'the', 'with',
]);
const PRODUCT_FORM_TOKENS = new Set([
  'bar', 'bread', 'candy', 'cereal', 'chip', 'cookie', 'cracker', 'dressing',
  'juice', 'marshmallow', 'oil', 'salad', 'sauce', 'snack', 'soup', 'tortilla',
  'waffle', 'yogurt',
]);
const LEARNING_NOISE_MARKERS = /\b(?:sales? tax|estimated tax|subtotal|order total|gratuity|service fee|delivery fee|remove salt|no ice|extra ice|iced coffee|drip coffee|latte|cappuccino)\b/i;
const TOKEN_ALIASES = new Map([
  ['fillet', 'filet'],
  ['breasts', 'breast'],
  ['tenders', 'tender'],
  ['veggies', 'vegetable'],
]);

function candidateTokens(value = '') {
  return normalizeComparableDescription(value)
    .split(' ')
    .map((token) => TOKEN_ALIASES.get(token) || token)
    .filter((token) => token.length >= 3 && !FAMILY_STOP_WORDS.has(token));
}

function scoreLabelPair(leftLabel, rightLabel) {
  const leftTokens = [...new Set(candidateTokens(leftLabel))];
  const rightTokens = [...new Set(candidateTokens(rightLabel))];
  if (!leftTokens.length || !rightTokens.length) return null;
  const leftForms = leftTokens.filter((token) => PRODUCT_FORM_TOKENS.has(token)).sort();
  const rightForms = rightTokens.filter((token) => PRODUCT_FORM_TOKENS.has(token)).sort();
  if (leftForms.join('|') !== rightForms.join('|')) return null;
  const rightSet = new Set(rightTokens);
  const common = leftTokens.filter((token) => rightSet.has(token));
  if (!common.length) return null;
  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  const containment = common.length / Math.min(leftTokens.length, rightTokens.length);
  const jaccard = common.length / unionSize;
  const score = Number((containment * 0.65 + jaccard * 0.35).toFixed(4));
  const hasSpecificCore = common.length >= 2 || common.some((token) => token.length >= 7);
  if (!hasSpecificCore || containment < 0.66 || score < 0.76) return null;
  return {
    score,
    signature: common.join(' '),
    common_tokens: common,
  };
}

function learnedFamilyKey(signature) {
  const slug = `${signature || 'item'}`
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'item';
  const digest = crypto.createHash('sha1').update(`${signature}`).digest('hex').slice(0, 8);
  return `learned:${slug}:${digest}`;
}

function learnedFamilyName(signature) {
  return normalizeItemDisplayName(signature) || 'Matched item';
}

function groupIdentityRows(rows = []) {
  const groups = new Map();
  rows.forEach((row) => {
    const itemKey = `${row?.comparable_key || ''}`.trim();
    if (!itemKey || !classifyItemInsightContext(row).eligible) return;
    const label = cleanItemDescription(row.item_name || row.description);
    if (LEARNING_NOISE_MARKERS.test(label)) return;
    if (!isInsightEligibleItemIdentity({ item_name: label, comparable_key: itemKey })) return;
    if (!groups.has(itemKey)) {
      groups.set(itemKey, {
        item_key: itemKey,
        label: normalizeItemDisplayName(label) || label,
        rows: [],
        occurrence_count: 0,
        merchants: new Set(),
      });
    }
    const group = groups.get(itemKey);
    group.rows.push(row);
    group.occurrence_count += Math.max(1, Number(row.occurrence_count) || 1);
    const merchants = Array.isArray(row.merchants) ? row.merchants : [row.merchant];
    merchants.filter(Boolean).forEach((merchant) => group.merchants.add(merchant));
  });
  return [...groups.values()]
    .map((group) => ({
      ...group,
      merchants: [...group.merchants],
    }));
}

function establishedFamilyForGroup(group, assignmentsByKey) {
  const assigned = assignmentsByKey.get(group.item_key);
  if (assigned) {
    return {
      family_key: assigned.family_key,
      family_name: assigned.family_name,
      family_signature: assigned.family_signature,
      source: 'learned',
    };
  }
  const seeded = deriveItemFamilyIdentity(group.rows[0]);
  return seeded ? { ...seeded, family_signature: null, source: 'seeded' } : null;
}

function buildItemFamilyCandidates(rows = [], assignments = [], { limit = 10 } = {}) {
  const groups = groupIdentityRows(rows);
  const assignmentsByKey = new Map(assignments.map((assignment) => [assignment.item_key, assignment]));
  const candidates = [];

  for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
      const left = groups[leftIndex];
      const right = groups[rightIndex];
      const totalOccurrences = left.occurrence_count + right.occurrence_count;
      if (totalOccurrences < 3 || Math.max(left.occurrence_count, right.occurrence_count) < 2) continue;
      const labelMatch = scoreLabelPair(left.label, right.label);
      if (!labelMatch) continue;

      const leftFamily = establishedFamilyForGroup(left, assignmentsByKey);
      const rightFamily = establishedFamilyForGroup(right, assignmentsByKey);
      if (leftFamily && rightFamily) {
        if (leftFamily.family_key === rightFamily.family_key) continue;
        continue;
      }
      const establishedFamily = leftFamily || rightFamily;
      if (establishedFamily?.source === 'seeded') continue;
      const suggestedFamilyKey = establishedFamily?.family_key || learnedFamilyKey(labelMatch.signature);
      const suggestedFamilyName = establishedFamily?.family_name || learnedFamilyName(labelMatch.signature);
      const familySignature = establishedFamily?.family_signature || labelMatch.signature;
      const pair = [left, right].sort((a, b) => a.item_key.localeCompare(b.item_key));

      candidates.push({
        left_item_key: pair[0].item_key,
        right_item_key: pair[1].item_key,
        left_label: pair[0].label,
        right_label: pair[1].label,
        suggested_family_key: suggestedFamilyKey,
        suggested_family_name: suggestedFamilyName,
        family_signature: familySignature,
        similarity_score: labelMatch.score,
        evidence: {
          left_occurrence_count: pair[0].occurrence_count,
          right_occurrence_count: pair[1].occurrence_count,
          left_merchants: pair[0].merchants.slice(0, 5),
          right_merchants: pair[1].merchants.slice(0, 5),
          common_tokens: labelMatch.common_tokens,
          established_family_source: establishedFamily?.source || null,
        },
      });
    }
  }

  const ranked = candidates
    .sort((a, b) => (
      b.similarity_score - a.similarity_score
      || (b.evidence.left_occurrence_count + b.evidence.right_occurrence_count)
        - (a.evidence.left_occurrence_count + a.evidence.right_occurrence_count)
    ));
  const selected = [];
  const usedItemKeys = new Set();
  for (const candidate of ranked) {
    if (usedItemKeys.has(candidate.left_item_key) || usedItemKeys.has(candidate.right_item_key)) continue;
    selected.push(candidate);
    usedItemKeys.add(candidate.left_item_key);
    usedItemKeys.add(candidate.right_item_key);
    if (selected.length >= Math.max(1, Math.min(Number(limit) || 10, 250))) break;
  }
  return selected;
}

async function discoverItemFamilyCandidates({ householdId, requesterUserId, lookbackDays = 365, limit = 10 }) {
  const [rows, assignments] = await Promise.all([
    ItemFamilyLearning.loadCandidateGroups(householdId, requesterUserId, lookbackDays),
    ItemFamilyLearning.findAssignments(householdId),
  ]);
  const generated = buildItemFamilyCandidates(rows, assignments, { limit: 250 });
  await ItemFamilyLearning.saveCandidates(householdId, generated);
  return ItemFamilyLearning.listPending(householdId, limit);
}

module.exports = {
  buildItemFamilyCandidates,
  candidateTokens,
  discoverItemFamilyCandidates,
  learnedFamilyKey,
  scoreLabelPair,
};
