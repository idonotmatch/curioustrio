module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/routes/',
    '/tests/models/',
    '/tests/services/categoryAssigner.test.js',
    '/tests/services/duplicateDetector.test.js',
    '/tests/services/recurringDetector.test.js',
  ],
};
