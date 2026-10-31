const assert = require('assert');
const {
  ADAPTIVE_MAX_WIDTHS,
  contentWidthFor,
  createAdaptiveLayout,
} = require('../services/adaptiveLayout');

const phone = createAdaptiveLayout({
  width: 393,
  height: 852,
  insets: { top: 59, right: 0, bottom: 34, left: 0 },
});
assert.equal(phone.sizeClass, 'compact');
assert.equal(phone.gutter, 20);
assert.equal(phone.isLandscapeLike, false);
assert.equal(phone.isTwoPane, false);
assert.equal(contentWidthFor(phone, 'feed'), 353);

const resized = createAdaptiveLayout({
  width: 744,
  height: 1080,
  insets: { top: 24, right: 8, bottom: 20, left: 8 },
});
assert.equal(resized.sizeClass, 'wide');
assert.equal(resized.availableWidth, 728);
assert.equal(resized.gutter, 28);
assert.equal(resized.isTwoPane, false);
assert.equal(contentWidthFor(resized, 'form'), 624);

const expanded = createAdaptiveLayout({
  width: 1366,
  height: 1024,
  insets: { top: 24, right: 0, bottom: 20, left: 0 },
});
assert.equal(expanded.sizeClass, 'expanded');
assert.equal(expanded.isLandscapeLike, true);
assert.equal(expanded.isTwoPane, true);
assert.equal(contentWidthFor(expanded, 'dashboard'), ADAPTIVE_MAX_WIDTHS.dashboard - (expanded.gutter * 2));

const divided = createAdaptiveLayout({
  width: 520,
  height: 720,
  insets: { top: 0, right: 12, bottom: 0, left: 12 },
});
assert.equal(divided.sizeClass, 'compact');
assert.equal(divided.availableWidth, 496);
assert.equal(divided.isTwoPane, false);
assert.equal(contentWidthFor(divided, 'feed'), 456);

const openDuo = createAdaptiveLayout({
  width: 932,
  height: 760,
  insets: { top: 24, right: 0, bottom: 20, left: 0 },
});
assert.equal(openDuo.sizeClass, 'expanded');
assert.equal(openDuo.isTwoPane, true);

console.log('adaptive layout tests passed');
