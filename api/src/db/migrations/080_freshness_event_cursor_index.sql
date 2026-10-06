CREATE INDEX IF NOT EXISTS household_freshness_events_created_cursor_idx
  ON household_freshness_events(created_at ASC, id ASC);
