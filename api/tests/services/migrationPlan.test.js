const fs = require('fs');
const path = require('path');
const { MIGRATION_PLAN } = require('../../src/db/migrationPlan');

describe('migrationPlan', () => {
  it('covers every SQL migration exactly once', () => {
    const migrationsDir = path.join(__dirname, '..', '..', 'src', 'db', 'migrations');
    const discoveredFiles = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));

    expect(MIGRATION_PLAN).toEqual(expect.arrayContaining(discoveredFiles));
    expect(discoveredFiles).toEqual(expect.arrayContaining(MIGRATION_PLAN));
    expect(new Set(MIGRATION_PLAN).size).toBe(MIGRATION_PLAN.length);
  });
});
