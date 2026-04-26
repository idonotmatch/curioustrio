const integration = require('./jest.integration.config');

module.exports = {
  ...integration,
  testMatch: ['**/tests/models/**/*.test.js'],
};
