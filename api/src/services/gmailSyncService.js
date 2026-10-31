const User = require('../models/user');
const OAuthToken = require('../models/oauthToken');
const BackgroundJob = require('../models/backgroundJob');
const { importForUser } = require('./gmailImporter');

function failureReasonCounts(result = {}) {
  return Object.entries(result?.outcomes?.failed_reasons || {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));
}

function partialSyncMessage(result = {}) {
  const failed = Math.max(0, Number(result.failed || 0));
  const reasons = failureReasonCounts(result)
    .slice(0, 3)
    .map(([reason, count]) => `${reason}:${count}`)
    .join(', ');
  return `${failed} message import${failed === 1 ? '' : 's'} failed${reasons ? ` (${reasons})` : ''}`.slice(0, 500);
}

async function recordGmailSyncResult(userId, result = {}, { source } = {}) {
  if (Number(result.failed || 0) > 0) {
    await OAuthToken.markSyncPartial(userId, {
      source,
      error: partialSyncMessage(result),
    });
    return 'partial';
  }
  await OAuthToken.markSynced(userId, { source });
  return 'success';
}

function normalizeSyncSource(source) {
  return ['app_open', 'manual', 'scheduler', 'oauth_connect'].includes(source)
    ? source
    : 'manual';
}

async function enqueueGmailSync(userId, { source = 'manual' } = {}) {
  const normalizedSource = normalizeSyncSource(source);
  const job = await BackgroundJob.enqueue({
    jobType: BackgroundJob.JOB_TYPES.gmailSync,
    dedupeKey: userId,
    payload: {
      user_id: userId,
      source: normalizedSource,
    },
    maxAttempts: 4,
  });
  await OAuthToken.markSyncQueued(userId, { source: normalizedSource });
  return job;
}

async function runGmailSyncJob(payload = {}) {
  const userId = `${payload.user_id || ''}`.trim();
  const source = normalizeSyncSource(payload.source);
  if (!userId) throw new Error('Gmail sync job is missing user_id');
  const user = await User.findById(userId);
  if (!user) throw new Error('Connected Gmail account has no user record');

  await OAuthToken.markSyncAttempt(userId, { source });
  try {
    const result = await importForUser(user);
    const syncStatus = await recordGmailSyncResult(userId, result, { source });
    return { ...result, sync_status: syncStatus };
  } catch (error) {
    await OAuthToken.markSyncFailure(userId, {
      source,
      error: `${error?.message || 'Unknown Gmail sync error'}`.slice(0, 500),
    });
    throw error;
  }
}

function createSchedulerResult(accountCount) {
  return {
    ok: true,
    accepted: true,
    execution_pending: true,
    connected_accounts: accountCount,
    users_processed: 0,
    users_failed: 0,
    users_queued: 0,
    failure_reasons: {},
  };
}

async function runScheduledGmailSync({ onAccountError = null } = {}) {
  const userIds = await OAuthToken.findAllWithGmail();
  const summary = createSchedulerResult(userIds.length);

  for (const userId of userIds) {
    try {
      await enqueueGmailSync(userId, { source: 'scheduler' });
      summary.users_processed += 1;
      summary.users_queued += 1;
    } catch (error) {
      summary.users_failed += 1;
      summary.failure_reasons.account_sync_failed = (summary.failure_reasons.account_sync_failed || 0) + 1;
      try {
        await OAuthToken.markSyncFailure(userId, {
          source: 'scheduler',
          error: `${error?.message || 'Unknown Gmail sync error'}`.slice(0, 500),
        });
      } catch (statusError) {
        onAccountError?.(statusError, { phase: 'record_failure', userId });
      }
      onAccountError?.(error, { phase: 'sync', userId });
    }
  }

  // This endpoint confirms durable queue acceptance. Import execution happens
  // in workers and is reflected by each connection's sync status afterward.
  summary.ok = summary.users_failed === 0;
  summary.accepted = summary.ok;
  return summary;
}

module.exports = {
  enqueueGmailSync,
  failureReasonCounts,
  partialSyncMessage,
  recordGmailSyncResult,
  runGmailSyncJob,
  runScheduledGmailSync,
};
