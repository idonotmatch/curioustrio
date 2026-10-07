const { createClient } = require('@supabase/supabase-js');

let cachedClient = null;
let cachedConfigKey = null;

function supabaseAdminConfigured() {
  return !!(
    `${process.env.SUPABASE_URL || ''}`.trim()
    && `${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`.trim()
  );
}

function configurationError() {
  const error = new Error('Account deletion is temporarily unavailable');
  error.status = 503;
  error.expose = true;
  error.code = 'SUPABASE_ADMIN_NOT_CONFIGURED';
  return error;
}

function getAdminClient() {
  if (!supabaseAdminConfigured()) throw configurationError();
  const url = `${process.env.SUPABASE_URL}`.trim().replace(/\/+$/, '');
  const serviceRoleKey = `${process.env.SUPABASE_SERVICE_ROLE_KEY}`.trim();
  const configKey = `${url}:${serviceRoleKey.slice(-12)}`;

  if (!cachedClient || cachedConfigKey !== configKey) {
    cachedClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    cachedConfigKey = configKey;
  }
  return cachedClient;
}

function adminOperationError(operation, sourceError) {
  const error = new Error(`Could not ${operation} the authentication account`);
  error.status = 502;
  error.expose = true;
  error.code = 'SUPABASE_ADMIN_REQUEST_FAILED';
  error.cause = sourceError;
  return error;
}

async function assertSupabaseAuthUserExists(providerUid) {
  if (!supabaseAdminConfigured()) return { verified: false, reason: 'not_configured' };
  const client = getAdminClient();
  const { data, error } = await client.auth.admin.getUserById(providerUid);
  if (error || !data?.user) throw adminOperationError('verify', error);
  return { verified: true };
}

async function deleteSupabaseAuthUser(providerUid) {
  const client = getAdminClient();
  const { error } = await client.auth.admin.deleteUser(providerUid, false);
  if (error) throw adminOperationError('delete', error);
  return { deleted: true };
}

module.exports = {
  assertSupabaseAuthUserExists,
  deleteSupabaseAuthUser,
  supabaseAdminConfigured,
};
