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

function featureEnabled(name, defaultEnabled = true) {
  if (!Object.prototype.hasOwnProperty.call(process.env, name)) return defaultEnabled;
  return !['0', 'false', 'off'].includes(`${process.env[name] || ''}`.trim().toLowerCase());
}

function productionLikeLaunch() {
  return process.env.NODE_ENV === 'production' || process.env.ENFORCE_LAUNCH_ENV === '1';
}

function productionCriticalEnvVars() {
  const vars = [];

  if (featureEnabled('ENABLE_AI_PARSING', true)) {
    vars.push('ANTHROPIC_API_KEY');
  }

  if (featureEnabled('ENABLE_GMAIL_IMPORT', true)) {
    vars.push('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI');
  }

  if (featureEnabled('ENABLE_CRON_ROUTES', true)) {
    vars.push('CRON_SECRET');
  }

  return vars;
}

function getEnvValidationReport() {
  const missingRequired = REQUIRED_ENV_VARS.filter((name) => !isPresent(process.env[name]));
  const missingOptional = OPTIONAL_ENV_VARS.filter((name) => !isPresent(process.env[name]));
  const hasSupabaseAuthConfig = ['SUPABASE_JWKS_URI', 'SUPABASE_URL', 'SUPABASE_PROJECT_REF']
    .some((name) => isPresent(process.env[name]));

  if (!hasSupabaseAuthConfig) {
    missingRequired.push('SUPABASE_JWKS_URI|SUPABASE_URL|SUPABASE_PROJECT_REF');
  }

  if (productionLikeLaunch()) {
    for (const name of productionCriticalEnvVars()) {
      if (!isPresent(process.env[name]) && !missingRequired.includes(name)) {
        missingRequired.push(name);
      }
    }
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
  featureEnabled,
  getEnvValidationReport,
  productionCriticalEnvVars,
  productionLikeLaunch,
};
