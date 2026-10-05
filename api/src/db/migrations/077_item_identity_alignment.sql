-- Align historical line items with an existing canonical product only when the
-- comparable description has one unambiguous same-merchant candidate.
WITH unambiguous_matches AS (
  SELECT
    ei.id AS expense_item_id,
    MIN(p.id::text)::uuid AS product_id
  FROM expense_items ei
  JOIN expenses e ON e.id = ei.expense_id
  JOIN products p
    ON p.comparable_key = ei.comparable_key
   AND LOWER(p.merchant) = LOWER(e.merchant)
  WHERE ei.product_id IS NULL
    AND ei.comparable_key IS NOT NULL
    AND p.merchant IS NOT NULL
  GROUP BY ei.id
  HAVING COUNT(DISTINCT p.id) = 1
)
UPDATE expense_items ei
SET product_id = matches.product_id,
    product_match_confidence = COALESCE(ei.product_match_confidence, 'medium'),
    product_match_reason = COALESCE(ei.product_match_reason, 'normalized_backfill')
FROM unambiguous_matches matches
WHERE ei.id = matches.expense_item_id;

CREATE INDEX IF NOT EXISTS idx_products_comparable_merchant
  ON products (comparable_key, LOWER(merchant))
  WHERE comparable_key IS NOT NULL AND merchant IS NOT NULL;
