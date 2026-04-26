const integration = require('./jest.integration.config');

module.exports = {
  ...integration,
  testMatch: ['**/tests/routes/**/*.test.js'],
};
