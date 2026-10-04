-- Household projections created before requester-aware privacy filtering can
-- contain another member's private spending. Identify current and former
-- household users before deleting any of the records used for identification.
WITH affected_users AS MATERIALIZED (
  SELECT id AS user_id
  FROM users
  WHERE household_id IS NOT NULL
  UNION
  SELECT user_id
  FROM user_summary_snapshots
  WHERE household_id IS NOT NULL
  UNION
  SELECT user_id
  FROM insight_forecasts
  WHERE scope = 'household'
  UNION
  SELECT user_id
  FROM insight_forecast_snapshots
  WHERE scope = 'household'
  UNION
  SELECT ips.user_id
  FROM insight_portfolio_snapshots ips
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(ips.insights) = 'array' THEN ips.insights
        ELSE '[]'::jsonb
      END
    ) AS insight
    WHERE insight->>'scope' = 'household'
  )
), deleted_calibration AS (
  DELETE FROM forecast_model_calibration calibration
  USING affected_users affected
  WHERE calibration.user_id = affected.user_id
  RETURNING calibration.user_id
), deleted_summaries AS (
  DELETE FROM user_summary_snapshots snapshots
  USING affected_users affected
  WHERE snapshots.user_id = affected.user_id
  RETURNING snapshots.user_id
)
DELETE FROM insight_portfolio_snapshots snapshots
USING affected_users affected
WHERE snapshots.user_id = affected.user_id;

DELETE FROM insight_forecast_snapshots WHERE scope = 'household';
DELETE FROM insight_forecasts WHERE scope = 'household';
