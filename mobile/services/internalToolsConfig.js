function mobileInternalToolsEnabled(explicitFlag) {
  return `${explicitFlag || ''}`.trim() === '1';
}

module.exports = {
  mobileInternalToolsEnabled,
};
