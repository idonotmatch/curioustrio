ALTER TABLE email_import_log
  ADD COLUMN IF NOT EXISTS structured_item_block_level TEXT;

ALTER TABLE email_import_log
  ADD COLUMN IF NOT EXISTS deterministic_item_count INT;
