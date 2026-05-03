export const INTERNAL_TOOLS_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_INTERNAL_TOOLS === '1';

export function isInternalToolsEnabled() {
  return INTERNAL_TOOLS_ENABLED;
}
