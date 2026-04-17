const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'TOKEN_ENCRYPTION_KEY',
  'EMAIL_HASH_SECRET',
];

const OPTIONAL_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'SUPABASE_JWKS_URI',
  'SUPABASE_URL',
  'SUPABASE_PROJECT_REF',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'CRON_SECRET',
];

function isPresent(value) {
  return `${value || ''}`.trim().length > 0;
}

function getEnvValidationReport() {
  const missingRequired = REQUIRED_ENV_VARS.filter((name) => !isPresent(process.env[name]));
  const missingOptional = OPTIONAL_ENV_VARS.filter((name) => !isPresent(process.env[name]));
  const hasSupabaseAuthConfig = ['SUPABASE_JWKS_URI', 'SUPABASE_URL', 'SUPABASE_PROJECT_REF']
    .some((name) => isPresent(process.env[name]));

  if (!hasSupabaseAuthConfig) {
    missingRequired.push('SUPABASE_JWKS_URI|SUPABASE_URL|SUPABASE_PROJECT_REF');
  }

  return {
    missingRequired,
    missingOptional,
    passed: missingRequired.length === 0,
  };
}

module.exports = {
  REQUIRED_ENV_VARS,
  OPTIONAL_ENV_VARS,
  getEnvValidationReport,
};
