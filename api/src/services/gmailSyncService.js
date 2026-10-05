const User = require('../models/user');
const OAuthToken = require('../models/oauthToken');
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

function createSchedulerResult(accountCount) {
  return {
    ok: true,
    connected_accounts: accountCount,
    users_processed: 0,
    users_succeeded: 0,
    users_partial: 0,
    users_failed: 0,
    total_imported: 0,
    total_skipped: 0,
    total_failed: 0,
    failure_reasons: {},
  };
}

function incrementReasons(target, source = {}) {
  for (const [reason, count] of Object.entries(source || {})) {
    target[reason] = (target[reason] || 0) + Number(count || 0);
  }
}

async function runScheduledGmailSync({ onAccountError = null } = {}) {
  const userIds = await OAuthToken.findAllWithGmail();
  const summary = createSchedulerResult(userIds.length);

  for (const userId of userIds) {
    try {
      const user = await User.findById(userId);
      if (!user) throw new Error('Connected Gmail account has no user record');

      await OAuthToken.markSyncAttempt(userId, { source: 'scheduler' });
      const result = await importForUser(user);
      const status = await recordGmailSyncResult(userId, result, { source: 'scheduler' });

      summary.users_processed += 1;
      summary.total_imported += Number(result.imported || 0);
      summary.total_skipped += Number(result.skipped || 0);
      summary.total_failed += Number(result.failed || 0);
      incrementReasons(summary.failure_reasons, result?.outcomes?.failed_reasons);
      if (status === 'partial') summary.users_partial += 1;
      else summary.users_succeeded += 1;
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

  summary.ok = summary.users_failed === 0 && summary.users_partial === 0 && summary.total_failed === 0;
  return summary;
}

module.exports = {
  failureReasonCounts,
  partialSyncMessage,
  recordGmailSyncResult,
  runScheduledGmailSync,
};
