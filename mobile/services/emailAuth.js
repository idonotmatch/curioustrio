const EMAIL_AUTH_MODES = {
  SIGN_IN: 'signin',
  SIGN_UP: 'signup',
};

const MIN_PASSWORD_LENGTH = 8;
const ANONYMOUS_AUTH_ENABLED = process.env.EXPO_PUBLIC_ANONYMOUS_AUTH_ENABLED === '1';

function normalizeAuthEmail(value) {
  return `${value || ''}`.trim().toLowerCase();
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateEmailAddress(email) {
  const normalizedEmail = normalizeAuthEmail(email);
  if (!normalizedEmail) return 'Enter your email address.';
  if (!looksLikeEmail(normalizedEmail)) return 'Enter a valid email address.';
  return null;
}

function validateEmailAuthInput({
  mode,
  email,
  password,
  confirmPassword,
}) {
  const emailError = validateEmailAddress(email);
  if (emailError) return emailError;
  if (!password) return 'Enter your password.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;
  }
  if (mode === EMAIL_AUTH_MODES.SIGN_UP && password !== confirmPassword) {
    return 'Passwords do not match yet.';
  }
  return null;
}

function buildEmailAuthSuccessMessage(email) {
  return `We sent a confirmation email to ${email}. Confirm it, then sign in.`;
}

function validatePasswordResetRequest(email) {
  return validateEmailAddress(email);
}

function buildPasswordResetRequestedMessage(email) {
  return `We sent a password reset link to ${email}. Open it on this device to choose a new password.`;
}

function validatePasswordUpdateInput({ password, confirmPassword }) {
  if (!password) return 'Enter your new password.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;
  }
  if (password !== confirmPassword) {
    return 'Passwords do not match yet.';
  }
  return null;
}

module.exports = {
  ANONYMOUS_AUTH_ENABLED,
  EMAIL_AUTH_MODES,
  MIN_PASSWORD_LENGTH,
  buildEmailAuthSuccessMessage,
  buildPasswordResetRequestedMessage,
  normalizeAuthEmail,
  validateEmailAddress,
  validateEmailAuthInput,
  validatePasswordResetRequest,
  validatePasswordUpdateInput,
};
