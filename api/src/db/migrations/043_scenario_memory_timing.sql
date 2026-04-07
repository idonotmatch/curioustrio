ALTER TABLE scenario_memory
  ADD COLUMN IF NOT EXISTS timing_mode TEXT NOT NULL DEFAULT 'now';
