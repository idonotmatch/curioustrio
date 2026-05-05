const { internalToolsEnabled } = require('../../src/services/internalTools');

describe('internalToolsEnabled', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to disabled even outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.INTERNAL_TOOLS_ENABLED;
    expect(internalToolsEnabled()).toBe(false);
  });

  it('enables only with an explicit env flag', () => {
    process.env.INTERNAL_TOOLS_ENABLED = '1';
    expect(internalToolsEnabled()).toBe(true);
  });
});
