const OAuthToken = require('../models/oauthToken');
const EmailImportLog = require('../models/emailImportLog');
const { GMAIL_SEARCH_QUERY, listRecentMessages, getMessage } = require('./gmailClient');
const { extractSenderDomain } = require('./gmailImportFingerprint');

const DEFAULT_INBOX_QUERY = 'in:inbox newer_than:14d -category:promotions -category:social';

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function redactFromAddress(from = '') {
  const domain = extractSenderDomain(from);
  if (domain) return domain;
  return `${from || ''}`.trim().replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]').slice(0, 80) || null;
}

function sanitizeText(value, max = 140) {
  return `${value || ''}`
    .replace(/\s+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted-link]')
    .trim()
    .slice(0, max) || null;
}

function syncAgeHours(token) {
  const timestamp = token?.last_synced_at || token?.last_sync_attempted_at;
  if (!timestamp) return null;
  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(ageMs)) return null;
  return Math.max(0, Math.round(ageMs / 36_000) / 100);
}

function countLogs(logs) {
  return logs.reduce((acc, log) => {
    const status = log?.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    if (status === 'imported' && log?.expense_status === 'pending') acc.pending_review += 1;
    return acc;
  }, { imported: 0, skipped: 0, failed: 0, pending_review: 0, unknown: 0 });
}

function buildRecommendations({ token, inboxProbe, importProbe, recentLogCounts }) {
  const recommendations = [];
  const ageHours = syncAgeHours(token);

  if (!token) {
    recommendations.push({
      level: 'error',
      code: 'gmail_disconnected',
      message: 'Gmail is not connected for this account.',
    });
    return recommendations;
  }

  if (token.last_sync_status === 'failed') {
    recommendations.push({
      level: 'error',
      code: 'last_sync_failed',
      message: 'The last Gmail sync failed before completing.',
    });
  } else if (token.last_sync_status === 'partial') {
    recommendations.push({
      level: 'warning',
      code: 'last_sync_partial',
      message: 'The last Gmail sync completed, but one or more messages could not be imported.',
    });
  }

  if (ageHours == null) {
    recommendations.push({
      level: 'warning',
      code: 'never_synced',
      message: 'Gmail is connected, but no completed sync has been recorded.',
    });
  } else if (ageHours >= 24) {
    recommendations.push({
      level: 'warning',
      code: 'sync_stale',
      message: `Last Gmail sync is about ${Math.round(ageHours)} hours old.`,
    });
  }

  if ((inboxProbe?.unlogged_count || 0) > 0) {
    recommendations.push({
      level: 'warning',
      code: 'unlogged_inbox_messages',
      message: `${inboxProbe.unlogged_count} recent inbox message${inboxProbe.unlogged_count === 1 ? '' : 's'} have no import log yet.`,
    });
  }

  if ((importProbe?.unlogged_count || 0) > 0) {
    recommendations.push({
      level: 'warning',
      code: 'unlogged_import_query_messages',
      message: `${importProbe.unlogged_count} message${importProbe.unlogged_count === 1 ? '' : 's'} matching the import query have not been processed.`,
    });
  }

  if ((recentLogCounts.failed || 0) > 0) {
    recommendations.push({
      level: 'error',
      code: 'recent_failures',
      message: `${recentLogCounts.failed} recent import failure${recentLogCounts.failed === 1 ? '' : 's'} need retry or investigation.`,
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      level: 'ok',
      code: 'healthy',
      message: 'Recent Gmail import checks look healthy.',
    });
  }

  return recommendations;
}

async function describeMessage(userId, messageId, log = null) {
  if (log) {
    return {
      message_id: messageId,
      import_status: log.status,
      subject: sanitizeText(log.subject, 100),
      sender: log.sender_domain || redactFromAddress(log.from_address),
      imported_at: log.imported_at || null,
      skip_reason: log.skip_reason || null,
    };
  }

  try {
    const message = await getMessage(userId, messageId);
    return {
      message_id: messageId,
      import_status: 'unlogged',
      subject: sanitizeText(message.subject, 100),
      sender: redactFromAddress(message.from),
      received_at: message.receivedAt || null,
      snippet: sanitizeText(message.snippet, 140),
    };
  } catch (err) {
    return {
      message_id: messageId,
      import_status: 'unlogged',
      subject: null,
      sender: null,
      received_at: null,
      snippet: null,
      detail_error: sanitizeText(err?.message, 120),
    };
  }
}

async function probeMessages(userId, {
  label,
  query,
  limit,
  inspectUnloggedLimit = 5,
}) {
  const messages = await listRecentMessages(userId, { maxResults: limit, query });
  const rows = [];
  let loggedCount = 0;
  let unloggedCount = 0;
  const statusCounts = { imported: 0, skipped: 0, failed: 0, pending_review: 0 };

  for (const message of messages) {
    const messageId = message?.id;
    if (!messageId) continue;
    const log = await EmailImportLog.findByMessageId(userId, messageId);
    if (log) {
      loggedCount += 1;
      if (statusCounts[log.status] != null) statusCounts[log.status] += 1;
      if (log.status === 'imported' && log.expense_status === 'pending') statusCounts.pending_review += 1;
      if (rows.length < inspectUnloggedLimit && log.status === 'failed') {
        rows.push(await describeMessage(userId, messageId, log));
      }
    } else {
      unloggedCount += 1;
      if (rows.filter((row) => row.import_status === 'unlogged').length < inspectUnloggedLimit) {
        rows.push(await describeMessage(userId, messageId));
      }
    }
  }

  return {
    label,
    query,
    checked_count: messages.length,
    logged_count: loggedCount,
    unlogged_count: unloggedCount,
    status_counts: statusCounts,
    candidates: rows,
  };
}

async function getGmailImportHealth(user, options = {}) {
  const days = clampInt(options.days, 14, 1, 90);
  const limit = clampInt(options.limit, 25, 5, 50);
  const inboxQuery = `${options.inboxQuery || DEFAULT_INBOX_QUERY}`.trim();
  const token = await OAuthToken.findByUserId(user.id);
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const logs = await EmailImportLog.listByUser(user.id, Math.max(100, limit * 4));
  const recentLogs = logs.filter((log) => {
    if (!log?.imported_at) return false;
    const importedMs = new Date(log.imported_at).getTime();
    return Number.isFinite(importedMs) && importedMs >= cutoffMs;
  });
  const recentLogCounts = countLogs(recentLogs);

  let inboxProbe = {
    label: 'Recent inbox',
    query: inboxQuery,
    checked_count: 0,
    logged_count: 0,
    unlogged_count: 0,
    status_counts: { imported: 0, skipped: 0, failed: 0, pending_review: 0 },
    candidates: [],
    error: token ? null : 'Gmail is not connected.',
  };
  let importProbe = {
    label: 'Import query',
    query: GMAIL_SEARCH_QUERY,
    checked_count: 0,
    logged_count: 0,
    unlogged_count: 0,
    status_counts: { imported: 0, skipped: 0, failed: 0, pending_review: 0 },
    candidates: [],
    error: token ? null : 'Gmail is not connected.',
  };

  if (token) {
    try {
      inboxProbe = await probeMessages(user.id, {
        label: 'Recent inbox',
        query: inboxQuery,
        limit,
      });
    } catch (err) {
      inboxProbe = { ...inboxProbe, error: sanitizeText(err?.message, 160) || 'Could not query Gmail inbox.' };
    }

    try {
      importProbe = await probeMessages(user.id, {
        label: 'Import query',
        query: GMAIL_SEARCH_QUERY,
        limit,
        inspectUnloggedLimit: 3,
      });
    } catch (err) {
      importProbe = { ...importProbe, error: sanitizeText(err?.message, 160) || 'Could not query Gmail import search.' };
    }
  }

  return {
    window_days: days,
    generated_at: new Date().toISOString(),
    connected: !!token,
    sync: {
      last_synced_at: token?.last_synced_at || null,
      last_sync_attempted_at: token?.last_sync_attempted_at || null,
      last_sync_error_at: token?.last_sync_error_at || null,
      last_sync_error: sanitizeText(token?.last_sync_error, 180),
      last_sync_source: token?.last_sync_source || null,
      last_sync_status: token?.last_sync_status || null,
      age_hours: syncAgeHours(token),
    },
    recent_logs: {
      checked_count: recentLogs.length,
      counts: recentLogCounts,
      failures: recentLogs
        .filter((log) => log.status === 'failed')
        .slice(0, 5)
        .map((log) => ({
          id: log.id,
          message_id: log.message_id,
          subject: sanitizeText(log.subject, 100),
          sender: log.sender_domain || redactFromAddress(log.from_address),
          reason: sanitizeText(log.skip_reason, 120),
          imported_at: log.imported_at,
        })),
    },
    probes: {
      inbox: inboxProbe,
      import_query: importProbe,
    },
    recommendations: buildRecommendations({ token, inboxProbe, importProbe, recentLogCounts }),
  };
}

module.exports = {
  DEFAULT_INBOX_QUERY,
  getGmailImportHealth,
};
