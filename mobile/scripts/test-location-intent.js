const assert = require('assert');
const {
  currentLocationAction,
  scoreLocationCandidate,
  selectSuggestedLocationCandidate,
} = require('../services/locationIntent');

assert.deepStrictEqual(currentLocationAction(''), {
  mode: 'current_position',
  label: 'Current location',
});
assert.deepStrictEqual(currentLocationAction('Target'), {
  mode: 'merchant_nearby',
  label: 'Find nearby',
});
assert.strictEqual(currentLocationAction('Amazon').mode, 'current_position');

assert.strictEqual(scoreLocationCandidate('Target', {
  place_name: 'Target',
  distance_meters: 420,
}), 1);
assert.strictEqual(scoreLocationCandidate('Bobby Boy Bakeshop', {
  place_name: 'Bobby Boy Bake Shop',
  distance_meters: 800,
}), 0.98);
assert.strictEqual(scoreLocationCandidate('Target', {
  place_name: 'Target',
  distance_meters: 6200,
}), 0);

const selection = selectSuggestedLocationCandidate('Trader Joes', [
  { place_name: 'Unrelated Market', distance_meters: 100 },
  { place_name: "Trader Joe's", distance_meters: 900, mapkit_stable_id: '1,2' },
]);
assert.strictEqual(selection.value.place_name, "Trader Joe's");
assert.strictEqual(selection.reason, 'merchant_nearby_match');
assert.strictEqual(selectSuggestedLocationCandidate('Target', [
  { place_name: 'Unrelated Market', distance_meters: 100 },
]), null);

console.log('[mobile-logic] location intent checks passed');
