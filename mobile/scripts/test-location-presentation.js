const assert = require('assert');
const { buildMapsUrl, formatPlaceDistance } = require('../services/locationPresentation');

assert.strictEqual(formatPlaceDistance(80), 'Nearby');
assert.strictEqual(formatPlaceDistance(1609.344), '1.0 mi away');
assert.strictEqual(formatPlaceDistance(null), null);
assert.match(
  buildMapsUrl({ place_name: 'Corner Cafe', latitude: 40.7, longitude: -74 }, 'ios'),
  /^https:\/\/maps\.apple\.com\/\?/
);
assert.match(
  buildMapsUrl({ address: '123 Main St' }, 'android'),
  /google\.com\/maps\/search/
);
assert.strictEqual(buildMapsUrl({}, 'ios'), null);

console.log('[mobile-logic] location presentation checks passed');
