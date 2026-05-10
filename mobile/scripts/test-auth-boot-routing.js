const assert = require('assert');
const {
  isAuthEntryPath,
  shouldRouteToOnboarding,
  defaultAuthedRoute,
  resolveWithTimeout,
} = require('../services/authBootRouting');

async function run() {
  assert.strictEqual(
    isAuthEntryPath('/login'),
    true,
    'login should be treated as an auth entry path'
  );

  assert.strictEqual(
    isAuthEntryPath('/reset-password'),
    true,
    'password reset should be treated as an auth entry path'
  );

  assert.strictEqual(
    isAuthEntryPath('/(tabs)/summary'),
    false,
    'authenticated content should not be treated as an auth entry path'
  );

  assert.strictEqual(
    shouldRouteToOnboarding({ onboarding_complete: false }),
    true,
    'explicitly incomplete users should route to onboarding'
  );

  assert.strictEqual(
    shouldRouteToOnboarding({ onboarding_complete: true }),
    false,
    'completed users should not route to onboarding'
  );

  assert.strictEqual(
    shouldRouteToOnboarding(null),
    false,
    'unknown users should not be treated like onboarding users'
  );

  assert.strictEqual(
    defaultAuthedRoute({ onboarding_complete: false }, true),
    '/onboarding',
    'known incomplete users should route to onboarding when the route exists'
  );

  assert.strictEqual(
    defaultAuthedRoute({ onboarding_complete: false }, false),
    '/(tabs)/summary',
    'missing onboarding route should fall back to summary'
  );

  assert.strictEqual(
    defaultAuthedRoute({ onboarding_complete: true }, true),
    '/(tabs)/summary',
    'completed users should land on summary'
  );

  assert.strictEqual(
    defaultAuthedRoute(null, true),
    '/(tabs)/summary',
    'unknown users should land on summary when boot state cannot be resolved'
  );

  assert.strictEqual(
    await resolveWithTimeout(new Promise(() => {}), 5, 'fallback'),
    'fallback',
    'boot timeout helper should resolve fallback when a dependency hangs'
  );

  assert.strictEqual(
    await resolveWithTimeout(Promise.resolve('ready'), 50, 'fallback'),
    'ready',
    'boot timeout helper should preserve fast successful dependencies'
  );

  process.stdout.write('[mobile-logic] auth boot routing checks passed\n');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
