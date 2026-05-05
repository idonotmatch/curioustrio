function internalToolsEnabled() {
  return process.env.INTERNAL_TOOLS_ENABLED === '1';
}

module.exports = {
  internalToolsEnabled,
};
