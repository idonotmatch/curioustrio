const {
  featureEnabled,
  getEnvValidationReport,
  productionCriticalEnvVars,
} = require('../../src/startup/validateEnv');

describe('validateEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('treats launch-critical AI, Gmail, and cron envs as required in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://db';
    process.env.TOKEN_ENCRYPTION_KEY = 'secret';
    process.env.EMAIL_HASH_SECRET = 'email-secret';
    process.env.SUPABASE_JWKS_URI = 'https://example.com/.well-known/jwks.json';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.CRON_SECRET;

    const report = getEnvValidationReport();

    expect(report.passed).toBe(false);
    expect(report.missingRequired).toEqual(expect.arrayContaining([
      'ANTHROPIC_API_KEY',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
      'CRON_SECRET',
    ]));
  });

  it('allows explicitly disabled launch features to skip production-only env requirements', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://db';
    process.env.TOKEN_ENCRYPTION_KEY = 'secret';
    process.env.EMAIL_HASH_SECRET = 'email-secret';
    process.env.SUPABASE_JWKS_URI = 'https://example.com/.well-known/jwks.json';
    process.env.ENABLE_AI_PARSING = '0';
    process.env.ENABLE_GMAIL_IMPORT = '0';
    process.env.ENABLE_CRON_ROUTES = '0';

    const report = getEnvValidationReport();

    expect(report.missingRequired).not.toEqual(expect.arrayContaining([
      'ANTHROPIC_API_KEY',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
      'CRON_SECRET',
    ]));
  });

  it('parses feature flags conservatively', () => {
    process.env.ENABLE_AI_PARSING = 'false';
    expect(featureEnabled('ENABLE_AI_PARSING', true)).toBe(false);
    delete process.env.ENABLE_AI_PARSING;
    expect(featureEnabled('ENABLE_AI_PARSING', true)).toBe(true);
  });

  it('lists the expected production critical env groups', () => {
    delete process.env.ENABLE_AI_PARSING;
    delete process.env.ENABLE_GMAIL_IMPORT;
    delete process.env.ENABLE_CRON_ROUTES;
    expect(productionCriticalEnvVars()).toEqual(expect.arrayContaining([
      'ANTHROPIC_API_KEY',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
      'CRON_SECRET',
    ]));
  });
});
