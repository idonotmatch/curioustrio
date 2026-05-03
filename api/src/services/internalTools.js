function internalToolsEnabled() {
  return process.env.INTERNAL_TOOLS_ENABLED === '1' || process.env.NODE_ENV !== 'production';
}

module.exports = {
  internalToolsEnabled,
};
