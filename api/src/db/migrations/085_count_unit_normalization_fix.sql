WITH corrected_expense_items AS (
  UPDATE expense_items
  SET
    normalized_total_size_value = ROUND(
      normalized_size_value * COALESCE(NULLIF(quantity, 0), 1),
      3
    ),
    estimated_unit_price = CASE
      WHEN amount IS NOT NULL AND normalized_size_value * COALESCE(NULLIF(quantity, 0), 1) > 0
        THEN ROUND(amount / (normalized_size_value * COALESCE(NULLIF(quantity, 0), 1)), 4)
      ELSE estimated_unit_price
    END
  WHERE normalized_size_unit IN ('ct', 'ea')
    AND normalized_total_size_unit IN ('ct', 'ea')
    AND normalized_size_value IS NOT NULL
    AND normalized_pack_size IS NULL
    AND normalized_quantity = normalized_size_value
    AND ABS(
      normalized_total_size_value
      - (normalized_size_value * normalized_size_value * COALESCE(NULLIF(quantity, 0), 1))
    ) < 0.001
  RETURNING id, normalized_total_size_value, normalized_total_size_unit, estimated_unit_price
)
UPDATE product_price_observations observation
SET
  normalized_total_size_value = corrected.normalized_total_size_value,
  normalized_total_size_unit = corrected.normalized_total_size_unit,
  observed_unit_price = corrected.estimated_unit_price
FROM corrected_expense_items corrected
WHERE observation.metadata->>'expense_item_id' = corrected.id::text;

UPDATE products
SET normalized_total_size_value = normalized_size_value
WHERE normalized_size_unit IN ('ct', 'ea')
  AND normalized_total_size_unit IN ('ct', 'ea')
  AND normalized_size_value IS NOT NULL
  AND normalized_pack_size IS NULL
  AND normalized_quantity = normalized_size_value
  AND ABS(
    normalized_total_size_value - (normalized_size_value * normalized_size_value)
  ) < 0.001;
