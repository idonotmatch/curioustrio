const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  advanceFreshnessCursor,
  buildFreshnessEventsPath,
  compareFreshnessCursor,
} = require('../services/freshnessCursor');

const first = { id: '00000000-0000-0000-0000-000000000001', created_at: '2026-10-05T12:00:00.000Z' };
const second = { id: '00000000-0000-0000-0000-000000000002', created_at: first.created_at };
const later = { id: '00000000-0000-0000-0000-000000000001', created_at: '2026-10-05T12:00:01.000Z' };

assert(compareFreshnessCursor(second, first) > 0);
assert(compareFreshnessCursor(later, second) > 0);
assert.deepStrictEqual(advanceFreshnessCursor(first, [later, second]), later);
assert.strictEqual(
  buildFreshnessEventsPath(second),
  '/freshness/events?limit=100&since=2026-10-05T12%3A00%3A00.000Z&since_id=00000000-0000-0000-0000-000000000002'
);

const bridgeSource = fs.readFileSync(path.join(__dirname, '../services/householdFreshnessBridge.js'), 'utf8');
for (const marker of [
  'filter: `target_user_id=eq.${user.id}`',
  'filter: `household_id=eq.${user.household_id}`',
  'supabase.auth.onAuthStateChange',
  'MAX_POLL_PAGES',
]) {
  assert(bridgeSource.includes(marker), `freshness bridge is missing ${marker}`);
}

process.stdout.write('[mobile-logic] freshness cursor checks passed\n');
