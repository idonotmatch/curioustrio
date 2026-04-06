ALTER TABLE scenario_memory
  ADD COLUMN IF NOT EXISTS last_material_change TEXT
    CHECK (last_material_change IN ('improved', 'worsened', 'unchanged')),
  ADD COLUMN IF NOT EXISTS previous_affordability_status TEXT,
  ADD COLUMN IF NOT EXISTS previous_risk_adjusted_headroom_amount NUMERIC(12,2);
