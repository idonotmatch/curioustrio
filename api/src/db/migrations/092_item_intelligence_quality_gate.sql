BEGIN;

-- Preserve every visible line item, but classify legacy non-products correctly so
-- they cannot participate in matching, price histories, or generated insights.
WITH classified AS (
  SELECT id,
         CASE
           WHEN LOWER(description) ~ '^(discount|coupon|promo(tion)?|savings|reward|credit|markdown|sale discount)([[:space:]]|$)'
             THEN 'discount'
           WHEN LOWER(description) ~ '^(local |state |county |city |municipal |regional |[a-z ]+ transportation commerce )?((sales|lodging|occupancy|hotel|room) )?(tax|taxes|hst|gst|pst|vat)([[:space:](]|$)'
             OR LOWER(description) ~ '(sales|commerce|occupancy|lodging|hotel|room)[[:space:]]+tax(es)?([[:space:]]*\([^)]*\))?$'
             OR LOWER(description) ~ '^(tip|gratuity|booking fee|service charge|service fee|back of house support charge|support charge|delivery|delivery fee|standard delivery|shipping|handling|bag fee|surcharge|platform fee|processing fee)([[:space:]]|$)'
             THEN 'fee'
           WHEN LOWER(description) ~ '^(subtotal|total|order total|amount paid|amount charged|grand total|trip fare|ride fare|base fare|you paid|payment sent|payment received)([[:space:]]|$)'
             OR LOWER(description) ~ 'points? earned'
             OR LOWER(description) ~ '(let us know|let .{1,80} know how (your|the) (visit|experience|order) (was|went)|share your feedback|how (was|did) your (visit|experience|order)|take (our|a) survey|popular in your interests|sponsored items? to complement your purchase|or best offer|buy it now|thank you for ordering|we(''ll| will) let you know when your order has shipped)'
             THEN 'summary'
           ELSE NULL
         END AS next_item_type
  FROM expense_items
  WHERE COALESCE(item_type, 'product') = 'product'
)
UPDATE expense_items ei
SET item_type = classified.next_item_type,
    normalized_name = NULL,
    normalized_brand = NULL,
    normalized_size_value = NULL,
    normalized_size_unit = NULL,
    normalized_pack_size = NULL,
    normalized_quantity = NULL,
    normalized_total_size_value = NULL,
    normalized_total_size_unit = NULL,
    estimated_unit_price = NULL,
    comparable_key = NULL,
    product_id = NULL,
    product_match_confidence = NULL,
    product_match_reason = NULL
FROM classified
WHERE ei.id = classified.id
  AND classified.next_item_type IS NOT NULL;

COMMIT;
