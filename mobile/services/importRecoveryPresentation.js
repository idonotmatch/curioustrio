const { decodeHtmlEntities } = require('./text');

function importHistoryTitle(entry = {}) {
  const template = (entry.subject_pattern || '').replace(/^generic_/, '').replace(/_/g, ' ');
  return decodeHtmlEntities(entry.subject || '').trim()
    || (entry.subject_pattern && entry.subject_pattern !== 'unknown_subject'
      ? template.charAt(0).toUpperCase() + template.slice(1)
      : 'Email import');
}

function importHistoryReason(entry = {}) {
  if (entry.status === 'failed') return 'Import could not be completed';
  if (entry.expense_status === 'dismissed') return 'Previously imported and dismissed';
  if (entry.status === 'imported' || entry.skip_reason === 'existing') return 'Already imported';
  if ((entry.skip_reason || '').startsWith('template_skip_')) return 'Filtered by email template and review history';
  const reasons = {
    duplicate_expense: 'Previously skipped as a possible duplicate',
    missing_amount: 'No readable expense amount found',
    classifier_uncertain: 'Could not identify a final expense total',
    classifier_not_expense: 'No expense detected',
    heuristic_skip: 'Did not look like an expense',
    low_sender_quality: 'Filtered based on previous reviews of this sender',
  };
  return reasons[entry.skip_reason] || 'Email was not identified as an expense';
}

function importRecoveryMessage(result = {}) {
  if (result.imported > 0) return 'Added to Pending for your review.';
  if (result.failed > 0) return result.error || 'Import failed. Try again later.';
  if (result.reason === 'duplicate_expense') return 'This email needs a duplicate comparison before it can be added.';
  if (result.reason === 'existing') return 'This email has already been imported. No new expense was added.';
  if (['missing_amount', 'classifier_uncertain'].includes(result.reason)) return 'No readable expense amount was found. Nothing was added to Pending.';
  return 'This email was still filtered. Nothing was added to Pending.';
}

module.exports = { importHistoryTitle, importHistoryReason, importRecoveryMessage };
