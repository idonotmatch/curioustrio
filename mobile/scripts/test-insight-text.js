const assert = require('assert');
const { decodeHtmlEntities, normalizeDisplayText } = require('../services/text');

assert.strictEqual(decodeHtmlEntities('Spend &amp; save &#36;25'), 'Spend & save $25');
assert.strictEqual(
  normalizeDisplayText('You\u00e2\u20ac\u2122re **$42** over plan \u00c2\u00b7 review it'),
  "You're $42 over plan / review it"
);
assert.strictEqual(
  normalizeDisplayText('### What changed\n- `Dining` rose by 18%'),
  'What changed Dining rose by 18%'
);
assert.strictEqual(
  normalizeDisplayText('Plan now - the trend is still forming'),
  'Plan now - the trend is still forming'
);

process.stdout.write('[mobile-logic] insight text checks passed\n');
