const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/routes/',
    '/tests/models/',
    '/tests/services/categoryAssigner.test.js',
    '/tests/services/duplicateDetector.test.js',
    '/tests/services/recurringDetector.test.js',
  ],
};
