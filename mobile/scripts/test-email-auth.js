const assert = require('assert');
const {
  ANONYMOUS_AUTH_ENABLED,
  EMAIL_AUTH_MODES,
  MIN_PASSWORD_LENGTH,
  buildEmailAuthSuccessMessage,
  normalizeAuthEmail,
  validateEmailAuthInput,
} = require('../services/emailAuth');

function run() {
  assert.strictEqual(
    normalizeAuthEmail('  Person@Example.COM '),
    'person@example.com',
    'email addresses should normalize before auth requests'
  );

  assert.strictEqual(
    validateEmailAuthInput({
      mode: EMAIL_AUTH_MODES.SIGN_IN,
      email: '',
      password: 'password123',
      confirmPassword: '',
    }),
    'Enter your email address.',
    'blank emails should be rejected'
  );

  assert.strictEqual(
    validateEmailAuthInput({
      mode: EMAIL_AUTH_MODES.SIGN_IN,
      email: 'not-an-email',
      password: 'password123',
      confirmPassword: '',
    }),
    'Enter a valid email address.',
    'invalid email formats should be rejected'
  );

  assert.strictEqual(
    validateEmailAuthInput({
      mode: EMAIL_AUTH_MODES.SIGN_UP,
      email: 'person@example.com',
      password: 'short',
      confirmPassword: 'short',
    }),
    `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`,
    'short passwords should be rejected'
  );

  assert.strictEqual(
    validateEmailAuthInput({
      mode: EMAIL_AUTH_MODES.SIGN_UP,
      email: 'person@example.com',
      password: 'password123',
      confirmPassword: 'password124',
    }),
    'Passwords do not match yet.',
    'sign-up should require matching passwords'
  );

  assert.strictEqual(
    validateEmailAuthInput({
      mode: EMAIL_AUTH_MODES.SIGN_UP,
      email: 'person@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    }),
    null,
    'valid sign-up input should pass validation'
  );

  assert.strictEqual(
    buildEmailAuthSuccessMessage('person@example.com'),
    'We sent a confirmation email to person@example.com. Confirm it, then sign in.',
    'confirmation messaging should stay friendly and explicit'
  );

  assert.strictEqual(
    ANONYMOUS_AUTH_ENABLED,
    false,
    'anonymous auth should stay hidden unless it is explicitly enabled'
  );

  process.stdout.write('[mobile-logic] email auth checks passed\n');
}

run();
