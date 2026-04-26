const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['**/tests/**/*.test.js'],
};
