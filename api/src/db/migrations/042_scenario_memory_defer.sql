ALTER TABLE scenario_memory
  ADD COLUMN IF NOT EXISTS deferred_until_month TEXT;

ALTER TABLE scenario_memory
  DROP CONSTRAINT IF EXISTS scenario_memory_memory_state_check;

ALTER TABLE scenario_memory
  ADD CONSTRAINT scenario_memory_memory_state_check
  CHECK (memory_state IN ('ephemeral', 'considering', 'suppressed', 'deferred'));

ALTER TABLE scenario_memory
  DROP CONSTRAINT IF EXISTS scenario_memory_resolution_action_check;

ALTER TABLE scenario_memory
  ADD CONSTRAINT scenario_memory_resolution_action_check
  CHECK (resolution_action IS NULL OR resolution_action IN ('bought', 'not_buying', 'revisit_next_month'));
