const assert = require('assert');
const {
  ADAPTIVE_MAX_WIDTHS,
  contentWidthFor,
  createAdaptiveLayout,
  horizontalCardWidthFor,
  safeAreaEdgesFor,
} = require('../services/adaptiveLayout');

const phone = createAdaptiveLayout({
  width: 393,
  height: 852,
  insets: { top: 59, right: 0, bottom: 34, left: 0 },
});
assert.equal(phone.sizeClass, 'compact');
assert.equal(phone.availableHeight, 759);
assert.equal(phone.gutter, 20);
assert.equal(phone.isLandscapeLike, false);
assert.equal(phone.isTwoPane, false);
assert.equal(phone.isLargeText, false);
assert.equal(phone.prefersCompactNavigation, false);
assert.equal(contentWidthFor(phone, 'feed'), 353);
assert.equal(horizontalCardWidthFor(phone, { count: 4, kind: 'feed' }), 305);

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
assert.equal(contentWidthFor(openDuo, 'dashboard'), 868);
assert.equal(horizontalCardWidthFor(openDuo, { count: 4, kind: 'dashboard' }), 720);

const closedDuo = createAdaptiveLayout({
  width: 720,
  height: 900,
  insets: { top: 24, right: 160, bottom: 20, left: 0 },
});
assert.equal(closedDuo.safeAvailableWidth, 560);
assert.equal(closedDuo.availableWidth, 720);
assert.equal(closedDuo.hasTrailingSystemRail, true);
assert.equal(closedDuo.trailingSystemRailWidth, 160);
assert.equal(closedDuo.breakpointWidth, 560);
assert.equal(closedDuo.sizeClass, 'compact');
assert.equal(closedDuo.isTwoPane, false);
assert.equal(contentWidthFor(closedDuo, 'feed'), 680);
assert.deepEqual(
  safeAreaEdgesFor(closedDuo, ['top', 'right', 'bottom', 'left']),
  ['top', 'bottom', 'left']
);
assert.deepEqual(
  safeAreaEdgesFor(closedDuo, ['top', 'right', 'left'], { reclaimTrailingSystemRail: false }),
  ['top', 'right', 'left']
);

const closedDuoCompactScale = createAdaptiveLayout({
  width: 466,
  height: 679,
  insets: { top: 16, right: 104, bottom: 12, left: 0 },
});
assert.equal(closedDuoCompactScale.safeAvailableWidth, 362);
assert.equal(closedDuoCompactScale.availableWidth, 466);
assert.equal(closedDuoCompactScale.hasTrailingSystemRail, true);
assert.equal(closedDuoCompactScale.trailingSystemRailWidth, 104);
assert.equal(closedDuoCompactScale.breakpointWidth, 362);
assert.equal(closedDuoCompactScale.sizeClass, 'compact');
assert.equal(closedDuoCompactScale.isTwoPane, false);
assert.equal(contentWidthFor(closedDuoCompactScale, 'feed'), 426);

const openDuoWithRail = createAdaptiveLayout({
  width: 1422,
  height: 1019,
  insets: { top: 24, right: 160, bottom: 20, left: 0 },
});
assert.equal(openDuoWithRail.safeAvailableWidth, 1262);
assert.equal(openDuoWithRail.availableWidth, 1422);
assert.equal(openDuoWithRail.hasTrailingSystemRail, true);
assert.equal(openDuoWithRail.isTwoPane, true);
assert.equal(contentWidthFor(openDuoWithRail, 'dashboard'), 1256);

const landscapePhone = createAdaptiveLayout({
  width: 852,
  height: 393,
  insets: { top: 0, right: 59, bottom: 21, left: 59 },
});
assert.equal(landscapePhone.isLandscapeLike, true);
assert.equal(landscapePhone.availableHeight, 372);
assert.equal(landscapePhone.isShortViewport, true);
assert.equal(landscapePhone.isTwoPane, false);
assert.equal(landscapePhone.prefersCompactNavigation, true);
assert.deepEqual(
  safeAreaEdgesFor(landscapePhone, ['top', 'right', 'left']),
  ['top', 'right', 'left']
);

const openDuoLargeText = createAdaptiveLayout({
  width: 932,
  height: 760,
  fontScale: 1.8,
  insets: { top: 24, right: 0, bottom: 20, left: 0 },
});
assert.equal(openDuoLargeText.isLargeText, true);
assert.equal(openDuoLargeText.isAccessibilityText, true);
assert.equal(openDuoLargeText.isTwoPane, false);
assert.equal(openDuoLargeText.prefersCompactNavigation, true);

const insetConstrained = createAdaptiveLayout({
  width: 932,
  height: 650,
  insets: { top: 59, right: 0, bottom: 34, left: 0 },
});
assert.equal(insetConstrained.availableHeight, 557);
assert.equal(insetConstrained.isShortViewport, true);
assert.equal(insetConstrained.isTwoPane, false);

console.log('adaptive layout tests passed');
