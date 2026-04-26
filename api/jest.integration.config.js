const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: [
    '**/tests/routes/**/*.test.js',
    '**/tests/models/**/*.test.js',
    '**/tests/services/categoryAssigner.test.js',
    '**/tests/services/duplicateDetector.test.js',
    '**/tests/services/recurringDetector.test.js',
  ],
  testPathIgnorePatterns: ['/node_modules/'],
  globalSetup: '<rootDir>/tests/globalIntegrationSetup.js',
};
