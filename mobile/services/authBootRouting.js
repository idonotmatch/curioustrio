function shouldRouteToOnboarding(user) {
  return !!user && user.onboarding_complete === false;
}

function defaultAuthedRoute(user, hasOnboardingRoute) {
  if (hasOnboardingRoute && shouldRouteToOnboarding(user)) return '/onboarding';
  return '/(tabs)/summary';
}

module.exports = {
  shouldRouteToOnboarding,
  defaultAuthedRoute,
};
