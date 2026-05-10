const assert = require('assert');
const {
  RESET_PASSWORD_ROUTE,
  endPasswordRecovery,
  beginPasswordRecovery,
  isPasswordRecoveryActive,
  parsePasswordRecoveryUrl,
} = require('../services/passwordRecovery');
const {
  buildPasswordResetRequestedMessage,
  validatePasswordResetRequest,
  validatePasswordUpdateInput,
} = require('../services/emailAuth');

function run() {
  assert.strictEqual(
    validatePasswordResetRequest(''),
    'Enter your email address.',
    'reset requests should require an email address'
  );

  assert.strictEqual(
    validatePasswordResetRequest('person@example.com'),
    null,
    'valid reset emails should pass validation'
  );

  assert.strictEqual(
    validatePasswordUpdateInput({
      password: 'password123',
      confirmPassword: 'password124',
    }),
    'Passwords do not match yet.',
    'reset updates should require matching passwords'
  );

  assert.strictEqual(
    buildPasswordResetRequestedMessage('person@example.com'),
    'We sent a password reset link to person@example.com. Open it on this device to choose a new password.',
    'reset messaging should explain the in-app handoff'
  );

  assert.deepStrictEqual(
    parsePasswordRecoveryUrl(
      'adlo://reset-password#access_token=abc&refresh_token=def&type=recovery'
    ),
    {
      isRecovery: true,
      path: RESET_PASSWORD_ROUTE,
      code: null,
      accessToken: 'abc',
      refreshToken: 'def',
      errorCode: null,
      errorDescription: null,
      type: 'recovery',
    },
    'implicit recovery links should expose both tokens'
  );

  assert.deepStrictEqual(
    parsePasswordRecoveryUrl(
      'adlo://reset-password?code=pkce-code&type=recovery'
    ),
    {
      isRecovery: true,
      path: RESET_PASSWORD_ROUTE,
      code: 'pkce-code',
      accessToken: null,
      refreshToken: null,
      errorCode: null,
      errorDescription: null,
      type: 'recovery',
    },
    'pkce recovery links should preserve the auth code'
  );

  assert.strictEqual(
    parsePasswordRecoveryUrl(
      'exp://127.0.0.1:8081/--/reset-password?code=pkce-code&type=recovery'
    ).path,
    RESET_PASSWORD_ROUTE,
    'expo dev-client reset links should normalize back to the in-app route'
  );

  assert.strictEqual(
    parsePasswordRecoveryUrl('adlo://login').isRecovery,
    false,
    'normal auth routes should not be treated as recovery links'
  );

  endPasswordRecovery();
  beginPasswordRecovery();
  assert.strictEqual(
    isPasswordRecoveryActive(),
    true,
    'recovery state should be tracked while the password form is active'
  );
  endPasswordRecovery();
  assert.strictEqual(
    isPasswordRecoveryActive(),
    false,
    'recovery state should clear after completion'
  );

  process.stdout.write('[mobile-logic] password recovery checks passed\n');
}

run();
