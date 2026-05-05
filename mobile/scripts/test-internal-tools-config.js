const assert = require('assert');
const { mobileInternalToolsEnabled } = require('../services/internalToolsConfig');

function run() {
  assert.strictEqual(
    mobileInternalToolsEnabled(undefined),
    false,
    'internal tools should be off by default'
  );

  assert.strictEqual(
    mobileInternalToolsEnabled('0'),
    false,
    'explicit off flag should remain disabled'
  );

  assert.strictEqual(
    mobileInternalToolsEnabled('1'),
    true,
    'explicit opt-in should enable internal tools'
  );

  process.stdout.write('[mobile-logic] internal tools config checks passed\n');
}

run();
