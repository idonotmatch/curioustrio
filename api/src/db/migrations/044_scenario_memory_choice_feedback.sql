ALTER TABLE scenario_memory
  ADD COLUMN IF NOT EXISTS last_recommended_timing_mode TEXT,
  ADD COLUMN IF NOT EXISTS last_choice_followed_recommendation BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_choice_source TEXT;

ALTER TABLE scenario_memory
  DROP CONSTRAINT IF EXISTS scenario_memory_last_recommended_timing_mode_check;

ALTER TABLE scenario_memory
  ADD CONSTRAINT scenario_memory_last_recommended_timing_mode_check
  CHECK (
    last_recommended_timing_mode IS NULL
    OR last_recommended_timing_mode IN ('now', 'next_period', 'spread_3_periods')
  );

ALTER TABLE scenario_memory
  DROP CONSTRAINT IF EXISTS scenario_memory_last_choice_source_check;

ALTER TABLE scenario_memory
  ADD CONSTRAINT scenario_memory_last_choice_source_check
  CHECK (
    last_choice_source IS NULL
    OR last_choice_source IN ('initial', 'compare_option', 'recent_plan')
  );
