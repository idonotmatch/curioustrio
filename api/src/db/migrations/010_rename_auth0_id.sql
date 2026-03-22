-- 010_rename_auth0_id.sql
ALTER TABLE users RENAME COLUMN auth0_id TO provider_uid;
