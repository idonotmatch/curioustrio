const assert = require('assert');
const { DEFAULT_MAX_AGE_MS, isCacheFresh } = require('../services/cachePolicy');

const now = 1_000_000;
assert.strictEqual(isCacheFresh(now - 1000, DEFAULT_MAX_AGE_MS, now), true);
assert.strictEqual(isCacheFresh(now - DEFAULT_MAX_AGE_MS, DEFAULT_MAX_AGE_MS, now), false);
assert.strictEqual(isCacheFresh(null, DEFAULT_MAX_AGE_MS, now), false);
assert.strictEqual(isCacheFresh(now - 1, 0, now), false);

process.stdout.write('[mobile-logic] cache policy checks passed\n');
