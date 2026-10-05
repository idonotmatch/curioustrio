const assert = require('assert');
const {
  stashNavigationPayload,
  getNavigationPayload,
  consumeNavigationPayload,
  getNavigationPayloadStoreSize,
} = require('../services/navigationPayloadStore');

const originalNow = Date.now;
let now = 1_000_000;
Date.now = () => now;

try {
  const firstKey = stashNavigationPayload({ index: 0 }, 'test');
  for (let index = 1; index < 55; index += 1) {
    now += 1;
    stashNavigationPayload({ index }, 'test');
  }
  assert.ok(getNavigationPayloadStoreSize() <= 50, 'payload store should be bounded');
  assert.strictEqual(getNavigationPayload(firstKey, null), null, 'oldest payload should be evicted');

  const consumedKey = stashNavigationPayload({ value: 'consume-once' }, 'test');
  assert.deepStrictEqual(consumeNavigationPayload(consumedKey), { value: 'consume-once' });
  assert.strictEqual(consumeNavigationPayload(consumedKey, null), null);

  const expiringKey = stashNavigationPayload({ value: 'short-lived' }, 'test');
  now += 16 * 60 * 1000;
  assert.strictEqual(getNavigationPayload(expiringKey, null), null, 'expired payload should not be returned');
} finally {
  Date.now = originalNow;
}

process.stdout.write('[mobile-logic] navigation payload store checks passed\n');
