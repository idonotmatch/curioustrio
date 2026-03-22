-- 011_users_email_nullable.sql
-- Email may be null for Apple Sign-In re-authentication flows
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
