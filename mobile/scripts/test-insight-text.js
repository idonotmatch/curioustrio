const assert = require('assert');
const { decodeHtmlEntities, normalizeDisplayText, normalizeInsightForDisplay } = require('../services/text');

assert.strictEqual(decodeHtmlEntities('Spend &amp; save &#36;25'), 'Spend & save $25');
assert.strictEqual(decodeHtmlEntities('Spacing:&#32;one&#160two'), 'Spacing: one\u00a0two');
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
assert.deepStrictEqual(
  normalizeInsightForDisplay({
    id: 'insight&#32;id',
    title: 'Dining&#32;changed',
    body: 'Spend&#160 increased',
    metadata: {
      merchant_key: 'merchant&#32;key',
      merchant_name: 'Corner&#32;Market',
      largest_expense: { merchant: 'Shop&#160 Name' },
    },
  }),
  {
    id: 'insight&#32;id',
    title: 'Dining changed',
    body: 'Spend increased',
    metadata: {
      merchant_key: 'merchant&#32;key',
      merchant_name: 'Corner Market',
      largest_expense: { merchant: 'Shop Name' },
    },
    forecast: {},
    action: undefined,
  }
);

process.stdout.write('[mobile-logic] insight text checks passed\n');
