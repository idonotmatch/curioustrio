export const colors = {
  background: '#0a0a0a',
  backgroundOverlay: 'rgba(10,10,10,0.68)',
  surface: '#111113',
  surfaceRaised: '#17171c',
  surfacePressed: '#202029',
  surfaceMuted: '#15151a',
  border: '#262633',
  borderSubtle: '#1b1b24',
  borderStrong: '#303044',
  text: '#f4f4ff',
  textMuted: '#aaaabe',
  textSubtle: '#77778c',
  textDisabled: '#5f5f70',
  textInverse: '#050509',
  brandIndigo: '#6366f1',
  accent: '#8c8ff0',
  accentPressed: '#7477dc',
  accentMuted: '#202153',
  success: '#6fd3a2',
  successMuted: '#11281e',
  danger: '#ee6b6e',
  dangerMuted: '#2c161b',
  warning: '#e0b15a',
  warningMuted: '#2a2112',
  info: '#a3a5f6',
  infoMuted: '#191a3f',
  overlay: 'rgba(10,10,10,0.62)',
  overlayStrong: 'rgba(10,10,10,0.72)',
  overlaySoft: 'rgba(10,10,10,0.48)',
  neutralWash: 'rgba(148,163,184,0.08)',
  neutralWashBorder: 'rgba(148,163,184,0.24)',
  successBorder: 'rgba(111,211,162,0.34)',
  warningBorder: 'rgba(224,177,90,0.34)',
  dangerBorder: 'rgba(238,107,110,0.34)',
  infoBorder: 'rgba(163,165,246,0.34)',
  onDarkOverlay: 'rgba(244,244,255,0.2)',
  onDarkOverlayStrong: 'rgba(244,244,255,0.5)',
};

export const radius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
  sheet: 22,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
};

export const typography = {
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 18,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: 0,
  },
  screenTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: 0,
  },
  metric: {
    fontSize: 48,
    lineHeight: 54,
    fontWeight: '650',
    letterSpacing: 0,
  },
};

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 };
export const minTapTarget = 44;

export const categoryTints = [
  '#8587e8',
  '#6fa9d7',
  '#70b8a2',
  '#b4a067',
  '#b985a6',
  '#8fa2d8',
  '#8cbf82',
  '#a791d2',
];

export function mutedCategoryColor(name) {
  if (!name) return colors.textDisabled;
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return categoryTints[Math.abs(h) % categoryTints.length];
}
