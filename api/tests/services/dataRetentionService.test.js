jest.mock('../../src/models/emailImportLog', () => ({ pruneOldRows: jest.fn() }));
jest.mock('../../src/models/ingestAttemptLog', () => ({ pruneOldRows: jest.fn() }));
jest.mock('../../src/models/backgroundJob', () => ({ pruneFinished: jest.fn() }));
jest.mock('../../src/models/householdFreshnessEvent', () => ({ pruneOldRows: jest.fn() }));

const EmailImportLog = require('../../src/models/emailImportLog');
const IngestAttemptLog = require('../../src/models/ingestAttemptLog');
const BackgroundJob = require('../../src/models/backgroundJob');
const HouseholdFreshnessEvent = require('../../src/models/householdFreshnessEvent');
const { runDataRetention } = require('../../src/services/dataRetentionService');

describe('dataRetentionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    EmailImportLog.pruneOldRows.mockResolvedValue({ deleted: 1 });
    IngestAttemptLog.pruneOldRows.mockResolvedValue({ deleted: 2 });
    BackgroundJob.pruneFinished.mockResolvedValue({ deleted: 3 });
    HouseholdFreshnessEvent.pruneOldRows.mockResolvedValue({ deleted: 4 });
  });

  it('prunes freshness events with the configured default window', async () => {
    const result = await runDataRetention();

    expect(HouseholdFreshnessEvent.pruneOldRows).toHaveBeenCalledWith(30);
    expect(result.freshness_events).toEqual({ deleted: 4 });
  });
});
