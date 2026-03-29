process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/expense_tracker_test';
process.env.SUPABASE_JWKS_URI = 'https://qybozqtugexupxqavtjj.supabase.co/auth/v1/.well-known/jwks.json';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.EMAIL_HASH_SECRET = 'test-secret-32chars-padded-xxxxx';
process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes as hex
