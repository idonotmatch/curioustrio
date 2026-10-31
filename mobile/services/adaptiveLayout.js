const ADAPTIVE_BREAKPOINTS = Object.freeze({
  wide: 600,
  expanded: 900,
});

const ADAPTIVE_MAX_WIDTHS = Object.freeze({
  form: 680,
  feed: 760,
  dashboard: 1120,
  sheet: 680,
});

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeInsets(insets = {}) {
  return {
    top: Math.max(0, finiteNumber(insets.top)),
    right: Math.max(0, finiteNumber(insets.right)),
    bottom: Math.max(0, finiteNumber(insets.bottom)),
    left: Math.max(0, finiteNumber(insets.left)),
  };
}

function createAdaptiveLayout({ width, height, fontScale = 1, insets = {} } = {}) {
  const safeWidth = Math.max(0, finiteNumber(width));
  const safeHeight = Math.max(0, finiteNumber(height));
  const safeInsets = normalizeInsets(insets);
  const availableWidth = Math.max(0, safeWidth - safeInsets.left - safeInsets.right);
  const isExpanded = availableWidth >= ADAPTIVE_BREAKPOINTS.expanded;
  const isWide = availableWidth >= ADAPTIVE_BREAKPOINTS.wide;
  const isLandscapeLike = safeWidth > safeHeight;
  const isTwoPane = availableWidth >= 820 && (isExpanded || isLandscapeLike);
  const sizeClass = isExpanded ? 'expanded' : isWide ? 'wide' : 'compact';
  const gutter = isExpanded ? 32 : isWide ? 28 : 20;

  return {
    width: safeWidth,
    height: safeHeight,
    availableWidth,
    fontScale: Math.max(0.5, finiteNumber(fontScale, 1)),
    insets: safeInsets,
    sizeClass,
    isCompact: !isWide,
    isWide,
    isExpanded,
    isLandscapeLike,
    isTwoPane,
    gutter,
    maxWidths: ADAPTIVE_MAX_WIDTHS,
  };
}

function contentWidthFor(layout, kind = 'feed', options = {}) {
  const maxWidth = layout?.maxWidths?.[kind] || ADAPTIVE_MAX_WIDTHS.feed;
  const gutter = options.includeGutters === false ? 0 : finiteNumber(layout?.gutter, 20) * 2;
  const outerWidth = Math.min(maxWidth, finiteNumber(layout?.availableWidth));
  return Math.max(0, outerWidth - gutter);
}

module.exports = {
  ADAPTIVE_BREAKPOINTS,
  ADAPTIVE_MAX_WIDTHS,
  contentWidthFor,
  createAdaptiveLayout,
};
