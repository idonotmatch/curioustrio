const AUTH_BOOT_SYNC_TIMEOUT_MS = 2500;
const AUTH_BOOT_CACHE_TIMEOUT_MS = 1200;
const AUTH_LINK_TIMEOUT_MS = 1500;
const AUTH_BOOT_SYNC_BACKGROUND_TIMEOUT_MS = 9000;

function shouldRouteToOnboarding(user) {
  return !!user && user.onboarding_complete === false;
}

function isAuthEntryPath(pathname) {
  return pathname === '/login' || pathname === '/reset-password';
}

function defaultAuthedRoute(user, hasOnboardingRoute) {
  if (hasOnboardingRoute && shouldRouteToOnboarding(user)) return '/onboarding';
  return '/(tabs)/summary';
}

function resolveWithTimeout(promise, timeoutMs, fallback = null) {
  let timeoutId = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

module.exports = {
  AUTH_BOOT_CACHE_TIMEOUT_MS,
  AUTH_BOOT_SYNC_BACKGROUND_TIMEOUT_MS,
  AUTH_BOOT_SYNC_TIMEOUT_MS,
  AUTH_LINK_TIMEOUT_MS,
  isAuthEntryPath,
  shouldRouteToOnboarding,
  defaultAuthedRoute,
  resolveWithTimeout,
};
