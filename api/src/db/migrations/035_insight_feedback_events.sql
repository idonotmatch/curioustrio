ALTER TABLE IF EXISTS insight_events
  DROP CONSTRAINT IF EXISTS insight_events_event_type_check;

ALTER TABLE IF EXISTS insight_events
  ADD CONSTRAINT insight_events_event_type_check
  CHECK (event_type IN ('shown', 'tapped', 'dismissed', 'acted', 'helpful', 'not_helpful'));
