const {
  cleanItemDescription,
  normalizeItemDisplayName,
  normalizeItemMetadata,
  normalizeText,
} = require('./itemNormalizer');

const PRODUCE_DERIVATIVE_MARKERS = /\b(?:bars?|baking mix|beverage|bread|butter|candy|cakes?|cereal|cheese|chips?|coffee|cookies?|cones?|crispy|crisps?|dressing|dried|entree|freeze dried|flavou?r|granola|ice cream|jam|jelly|juice|marshmallows?|milk|muf(?:fin)?s?|oil|paste|pastr(?:y|ies)|pickled|pies?|preserves?|puree|rolls?|salad|salsa|sauce|seltzer|smoothie|sna(?:ck)?s?|soda|soup|sparkling water|sticks?|tarts?|tea|teriyaki|toast|vinaigrette|waffles?|yogurt)\b/i;
const DINING_CONTEXT = /\b(?:bar|cafe|coffee shop|dining|fast food|restaurant|take ?out)\b/i;

function family(key, name, identity, stripIdentity, options = {}) {
  return {
    key,
    name,
    identity,
    stripIdentity,
    exclude: options.exclude || null,
    excludeDining: options.excludeDining !== false,
  };
}

// Families deliberately stay conservative. They unify purchase cadence and discovery;
// price comparisons still require a matching variant and package below.
const FAMILY_RULES = [
  family('produce:strawberry', 'Strawberries', /\b(?:strawberry|strawberries|strawbry|strawbrry|strawberrie|strawberr)\b/i, /\b(?:strawberry|strawberries|strawbry|strawbrry|strawberrie|strawberr)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:avocado', 'Avocados', /\b(?:avocado|avocados)\b/i, /\b(?:avocado|avocados)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:mandarin', 'Mandarins', /\b(?:mandarin|mandarins|clementine|clementines|tangerine|tangerines)\b/i, /\b(?:mandarin|mandarins|clementine|clementines|tangerine|tangerines)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:banana', 'Bananas', /\b(?:banana|bananas)\b/i, /\b(?:banana|bananas)\b/gi, { exclude: /\b(?:bread|chips?|dried|freeze dried|muffins?|smoothie|straw|yogurt)\b/i }),
  family('produce:apple', 'Apples', /\b(?:apple|apples)\b/i, /\b(?:apple|apples)\b/gi, { exclude: /\b(?:cider|crusher|crushed|juice|pie|sauce|soda|vinaigrette|watch|iphone|ipad|macbook|airpods?|computer|laptop|charger|case)\b/i }),
  family('produce:blueberry', 'Blueberries', /\b(?:blueberry|blueberries)\b/i, /\b(?:blueberry|blueberries)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:raspberry', 'Raspberries', /\b(?:raspberry|raspberries)\b/i, /\b(?:raspberry|raspberries)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:blackberry', 'Blackberries', /\b(?:blackberry|blackberries)\b/i, /\b(?:blackberry|blackberries)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:grape', 'Grapes', /\b(?:grape|grapes)\b/i, /\b(?:grape|grapes)\b/gi, { exclude: /\b(?:tomatoes?|juice|jelly|jam|soda|wine|raisins?)\b/i }),
  family('produce:lemon', 'Lemons', /\b(?:lemon|lemons)\b/i, /\b(?:lemon|lemons)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:lime', 'Limes', /\b(?:lime|limes)\b/i, /\b(?:lime|limes)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:mango', 'Mangoes', /\b(?:mango|mangoes|mangos)\b/i, /\b(?:mango|mangoes|mangos)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:pineapple', 'Pineapples', /\b(?:pineapple|pineapples)\b/i, /\b(?:pineapple|pineapples)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:watermelon', 'Watermelons', /\b(?:watermelon|watermelons)\b/i, /\b(?:watermelon|watermelons)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:tomato', 'Tomatoes', /\b(?:tomato|tomatoes)\b/i, /\b(?:tomato|tomatoes)\b/gi, { exclude: /\b(?:corn and chile|tomato le(?:ss)?|paste|salsa|sauce|soup|juice|dried)\b/i }),
  family('produce:sweet-potato', 'Sweet Potatoes', /\b(?:sweet potato|sweet potatoes|yam|yams)\b/i, /\b(?:sweet potato|sweet potatoes|yam|yams)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:potato', 'Potatoes', /\b(?:potato|potatoes)\b/i, /\b(?:potato|potatoes)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:onion', 'Onions', /\b(?:onion|onions)\b/i, /\b(?:onion|onions)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:garlic', 'Garlic', /\bgarlic\b/i, /\bgarlic\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:carrot', 'Carrots', /\b(?:carrot|carrots)\b/i, /\b(?:carrot|carrots)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:cucumber', 'Cucumbers', /\b(?:cucumber|cucumbers)\b/i, /\b(?:cucumber|cucumbers)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:zucchini', 'Zucchini', /\b(?:zucchini|zucchinis|courgette|courgettes)\b/i, /\b(?:zucchini|zucchinis|courgette|courgettes)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:spinach', 'Spinach', /\bspinach\b/i, /\bspinach\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:kale', 'Kale', /\bkale\b/i, /\bkale\b/gi, { exclude: /\b(?:broccoli|caesar|dried|salad|kit|soup|chips?|smoothie)\b/i }),
  family('produce:lettuce', 'Lettuce', /\b(?:lettuce|romaine)\b/i, /\b(?:lettuce|romaine)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:broccoli', 'Broccoli', /\bbroccoli\b/i, /\bbroccoli\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:cauliflower', 'Cauliflower', /\bcauliflower\b/i, /\bcauliflower\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:asparagus', 'Asparagus', /\basparagus\b/i, /\basparagus\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:celery', 'Celery', /\bcelery\b/i, /\bcelery\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('produce:mushroom', 'Mushrooms', /\b(?:mushroom|mushrooms)\b/i, /\b(?:mushroom|mushrooms)\b/gi, { exclude: PRODUCE_DERIVATIVE_MARKERS }),
  family('dairy:eggs', 'Eggs', /\b(?:egg|eggs)\b/i, /\b(?:egg|eggs)\b/gi, { exclude: /\b(?:eggplant|sandwich|salad|roll|noodle|nog)\b/i }),
  family('dairy:milk', 'Dairy Milk', /\bmilk\b/i, /\bmilk\b/gi, { exclude: /\b(?:almond|cashew|coconut|oat|rice|soy|chocolate|strawberry|formula|powder|shake|cream|ricotta|cheese|yogurt)\b/i }),
  family('beverage:oat-milk', 'Oat Milk', /\boat milk\b/i, /\b(?:oat milk|milk)\b/gi),
  family('beverage:almond-milk', 'Almond Milk', /\balmond milk\b/i, /\b(?:almond milk|milk)\b/gi),
  family('beverage:soy-milk', 'Soy Milk', /\bsoy milk\b/i, /\b(?:soy milk|milk)\b/gi),
  family('dairy:butter', 'Butter', /\bbutter\b/i, /\bbutter\b/gi, { exclude: /\b(?:peanut|almond|cashew|cookie|body|cocoa|apple|croissants?)\b/i }),
  family('dairy:yogurt', 'Yogurt', /\b(?:yogurt|yoghurt)\b/i, /\b(?:yogurt|yoghurt)\b/gi),
  family('dairy:feta', 'Feta', /\bfeta\b/i, /\bfeta\b/gi, { exclude: /\b(?:salad|sandwich|cracker|soup)\b/i }),
  family('dairy:cheddar', 'Cheddar', /\bcheddar\b/i, /\bcheddar\b/gi, { exclude: /\b(?:sandwich|cracker|chips?|popcorn)\b/i }),
  family('dairy:mozzarella', 'Mozzarella', /\bmozzarella\b/i, /\bmozzarella\b/gi, { exclude: /\b(?:pizza|sandwich|sticks?)\b/i }),
  family('dairy:parmesan', 'Parmesan', /\b(?:parmesan|parmigiano)\b/i, /\b(?:parmesan|parmigiano)\b/gi, { exclude: /\b(?:chips?|crisps?|crackers?)\b/i }),
  family('bakery:bread', 'Bread', /\bbread\b/i, /\bbread\b/gi, { exclude: /\b(?:banana|pumpkin|zucchini|quick bread|crumbs?|pudding|sticks?|sandwich|toast)\b/i }),
  family('pantry:rice', 'Rice', /\brice\b/i, /\brice\b/gi, { exclude: /\b(?:cakes?|crackers?|milk|pudding|noodles?|vinegar)\b/i }),
  family('pantry:flour', 'Flour', /\bflour\b/i, /\bflour\b/gi, { exclude: /\b(?:tortillas?|wraps?)\b/i }),
  family('pantry:pasta', 'Pasta', /\b(?:pasta|spaghetti|linguine|penne|rigatoni|macaroni|fettuccine)\b/i, /\b(?:pasta|spaghetti|linguine|penne|rigatoni|macaroni|fettuccine)\b/gi, { exclude: /\b(?:sauce|salad|prepared|frozen|meal|dinner)\b/i }),
  family('pantry:cereal', 'Cereal', /\bcereal\b/i, /\bcereal\b/gi, { exclude: /\b(?:bar|bars|milk)\b/i }),
  family('beverage:sparkling-water', 'Sparkling Water', /\b(?:sparkling water|seltzer)\b/i, /\b(?:sparkling water|seltzer)\b/gi),
  family('beverage:coffee', 'Coffee', /\b(?:coffee beans?|ground coffee|whole bean coffee|coffee pods?|coffee capsules?|instant coffee|k cups?)\b/i, /\bcoffee\b/gi, { exclude: /\b(?:cake|ice cream|scrub|table)\b/i }),
  family('beverage:tea', 'Tea', /\b(?:tea bags?|loose leaf tea|black tea|green tea|herbal tea|chai tea)\b/i, /\btea\b/gi, { exclude: /\b(?:tree|towel|light|shirt|dress|iced)\b/i }),
  family('household:paper-towels', 'Paper Towels', /\bpaper towels?\b/i, /\bpaper towels?\b/gi, { excludeDining: false }),
  family('household:toilet-paper', 'Toilet Paper', /\b(?:toilet paper|bath tissue)\b/i, /\b(?:toilet paper|bath tissue)\b/gi, { excludeDining: false }),
  family('household:laundry-detergent', 'Laundry Detergent', /\b(?:laundry detergent|laundry pods?|washing powder)\b/i, /\b(?:laundry detergent|laundry pods?|washing powder)\b/gi, { excludeDining: false }),
  family('household:dishwasher-detergent', 'Dishwasher Detergent', /\b(?:dishwasher detergent|dishwashing pods?|dishwasher pods?|dish tabs?)\b/i, /\b(?:dishwasher detergent|dishwashing pods?|dishwasher pods?|dish tabs?)\b/gi, { excludeDining: false }),
  family('household:trash-bags', 'Trash Bags', /\b(?:trash bags?|garbage bags?)\b/i, /\b(?:trash bags?|garbage bags?)\b/gi, { excludeDining: false }),
  family('baby:diapers', 'Diapers', /\bdiapers?\b/i, /\bdiapers?\b/gi, { excludeDining: false }),
  family('baby:wipes', 'Baby Wipes', /\b(?:baby wipes?|diaper wipes?)\b/i, /\b(?:baby wipes?|diaper wipes?)\b/gi, { excludeDining: false }),
  family('pet:dog-food', 'Dog Food', /\bdog food\b/i, /\bdog food\b/gi, { excludeDining: false }),
  family('pet:cat-food', 'Cat Food', /\bcat food\b/i, /\bcat food\b/gi, { excludeDining: false }),
];

const FAMILY_RULES_BY_KEY = new Map(FAMILY_RULES.map((rule) => [rule.key, rule]));

function sourceDescription(item = {}) {
  return cleanItemDescription(
    item.item_name
    || item.description
    || item.raw_description
    || item.normalized_name
    || ''
  );
}

function categoryContext(item = {}) {
  return normalizeText([
    item.category_group_name,
    item.parent_category_name,
    item.expense_category_name,
  ].filter(Boolean).join(' '));
}

function findFamilyRule(item = {}) {
  const normalized = normalizeText(sourceDescription(item));
  if (!normalized) return null;
  const category = categoryContext(item);
  return FAMILY_RULES.find((rule) => (
    rule.identity.test(normalized)
    && (!rule.exclude || !rule.exclude.test(normalized))
    && (!rule.excludeDining || !DINING_CONTEXT.test(category))
  )) || null;
}

function deriveItemFamilyIdentity(item = {}) {
  if (item.assigned_family_key && item.assigned_family_name) {
    return {
      family_key: `${item.assigned_family_key}`,
      family_name: `${item.assigned_family_name}`,
      family_signature: `${item.assigned_family_signature || item.assigned_family_name}`,
      family_source: `${item.assigned_family_source || 'user_confirmed'}`,
    };
  }
  const rule = findFamilyRule(item);
  if (!rule) return null;
  return { family_key: rule.key, family_name: rule.name };
}

function isSupportedItemFamilyKey(value) {
  const key = `${value || ''}`;
  return FAMILY_RULES_BY_KEY.has(key) || /^learned:[a-z0-9-]{1,64}:[a-f0-9]{8}$/.test(key);
}

function formatComparableNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric.toFixed(3).replace(/\.?0+$/, '');
}

function variantDescriptor(normalizedName, rule) {
  return normalizeText(normalizedName)
    .replace(rule.stripIdentity, ' ')
    .replace(/\borg\b/g, ' organic ')
    .replace(/\b(?:r|a|m|sh)\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function dynamicFamilyRule(familyIdentity) {
  const tokens = normalizeText(familyIdentity?.family_signature || familyIdentity?.family_name)
    .split(' ')
    .filter((token) => token.length >= 2)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return null;
  return { stripIdentity: new RegExp(`\\b(?:${tokens.join('|')})\\b`, 'gi') };
}

function formatSizeLabel(formattedSize, sizeUnit) {
  return `${formattedSize} ${sizeUnit === 'ct' || sizeUnit === 'ea' ? 'count' : sizeUnit.replace(/_/g, ' ')}`;
}

function derivePriceVariant(item = {}, familyIdentity = deriveItemFamilyIdentity(item)) {
  if (!familyIdentity) return null;
  const rule = FAMILY_RULES_BY_KEY.get(familyIdentity.family_key) || dynamicFamilyRule(familyIdentity);
  if (!rule) return null;
  const normalized = normalizeItemMetadata({
    description: sourceDescription(item),
    brand: item.brand || null,
    product_size: item.product_size || null,
    pack_size: item.pack_size || null,
    unit: item.unit || item.normalized_total_size_unit || null,
  });
  const descriptor = variantDescriptor(normalized.normalized_name || sourceDescription(item), rule);
  const descriptorKey = descriptor || 'standard';
  const descriptorLabel = descriptor ? normalizeItemDisplayName(descriptor) : null;
  const sizeValue = item.normalized_total_size_value ?? normalized.normalized_total_size_value;
  const sizeUnit = item.normalized_total_size_unit || normalized.normalized_total_size_unit;
  const formattedSize = formatComparableNumber(sizeValue);
  if (formattedSize && sizeUnit) {
    const sizeLabel = formatSizeLabel(formattedSize, sizeUnit);
    return {
      price_variant_key: `${familyIdentity.family_key}|variant:${descriptorKey}|size:${formattedSize}${sizeUnit}`,
      price_variant_label: descriptorLabel ? `${descriptorLabel}, ${sizeLabel}` : sizeLabel,
      price_comparison_confidence: 'high',
    };
  }

  const comparableKey = normalized.comparable_key || item.comparable_key || null;
  const productKey = item.product_id ? `product:${item.product_id}` : null;
  const identityKey = comparableKey ? `comparable:${`${comparableKey}`.slice(0, 250)}` : productKey;
  if (!identityKey) return null;
  return {
    price_variant_key: `${familyIdentity.family_key}|variant:${descriptorKey}|identity:${identityKey}`,
    price_variant_label: normalizeItemDisplayName(sourceDescription(item)) || familyIdentity.family_name,
    price_comparison_confidence: 'unknown_package',
  };
}

function enrichWithItemFamily(item = {}) {
  const familyIdentity = deriveItemFamilyIdentity(item);
  if (!familyIdentity) return { ...item };
  return { ...item, ...familyIdentity, ...derivePriceVariant(item, familyIdentity) };
}

function normalizeVariantPair(leftVariantKey, rightVariantKey) {
  return [`${leftVariantKey || ''}`, `${rightVariantKey || ''}`].sort();
}

module.exports = {
  deriveItemFamilyIdentity,
  derivePriceVariant,
  enrichWithItemFamily,
  isSupportedItemFamilyKey,
  normalizeVariantPair,
};
