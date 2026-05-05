const { mobileInternalToolsEnabled } = require('./internalToolsConfig');

export const INTERNAL_TOOLS_ENABLED = mobileInternalToolsEnabled(process.env.EXPO_PUBLIC_INTERNAL_TOOLS);

export function isInternalToolsEnabled() {
  return INTERNAL_TOOLS_ENABLED;
}
