const assert = require('assert');
const {
  shouldRouteToOnboarding,
  defaultAuthedRoute,
} = require('../services/authBootRouting');

function run() {
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

  process.stdout.write('[mobile-logic] auth boot routing checks passed\n');
}

run();
