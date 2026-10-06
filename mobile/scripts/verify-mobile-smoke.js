const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const projectRoot = path.join(__dirname, '..');
const filesToCheck = [
  'app/_layout.js',
  'app/accounts.js',
  'app/confirm.js',
  'app/diagnostics.js',
  'app/duplicate-review.js',
  'app/expense/[id].js',
  'app/email-import-health.js',
  'app/gmail-import.js',
  'app/insight-diagnostics.js',
  'app/login.js',
  'app/insight-detail.js',
  'app/manual-add.js',
  'app/onboarding.js',
  'app/recurring-item.js',
  'app/review-queue.js',
  'app/reset-password.js',
  'app/scenario-check.js',
  'app/watching-plans.js',
  'app/(tabs)/settings.js',
  'app/(tabs)/summary.js',
  'components/GlobalAddLauncher.js',
  'components/NLInput.js',
  'components/GmailImportOverview.js',
  'components/InsightCard.js',
  'components/InsightTrendVisual.js',
  'components/PendingExpenseReviewPanel.js',
  'components/PendingExpenseEmailCard.js',
  'components/PendingExpenseApprovalCard.js',
  'components/PendingExpenseAttentionCard.js',
  'components/PendingExpenseItemsCard.js',
  'components/SmartSuggestionCard.js',
  'components/SkippedImportsList.js',
  'components/SummaryInsightsRail.js',
  'components/ui/Buttons.js',
  'components/ui/MetricStrip.js',
  'components/ui/SegmentedControl.js',
  'components/ui/States.js',
  'components/ui/StatusChip.js',
  'services/insightPresentation.js',
  'services/itemInsightPresentation.js',
  'services/text.js',
  'services/insightTrendVisual.js',
  'services/manualAddSuggestions.js',
  'services/navigationPayloadStore.js',
  'services/confirmClientWork.js',
  'services/confirmNavigation.js',
  'services/apiConfig.js',
  'services/cache.js',
  'services/cachePolicy.js',
  'services/householdFreshnessBridge.js',
  'services/freshnessCursor.js',
  'services/currentUserCache.js',
  'services/emailAuth.js',
  'services/expenseMutationEffects.js',
  'services/expenseIdempotency.js',
  'services/expenseValidation.js',
  'services/observability.js',
  'services/provenancePresentation.js',
  'services/gmailAuthFlow.js',
  'services/importRecoveryPresentation.js',
  'services/itemEditing.js',
  'services/internalTools.js',
  'services/internalToolsConfig.js',
  'services/onboardingFlow.js',
  'services/passwordRecovery.js',
  'services/pushRegistration.js',
  'services/storageSanitizers.js',
  'services/authBootRouting.js',
  'services/scenarioCheckPresentation.js',
  'services/summarySnapshot.js',
  'hooks/useSummaryBundle.js',
  'hooks/useInsights.js',
  'hooks/useExpenses.js',
  'hooks/useHouseholdExpenses.js',
  'scripts/test-auth-boot-routing.js',
  'scripts/test-api-config.js',
  'scripts/test-email-auth.js',
  'scripts/test-expense-idempotency.js',
  'scripts/test-storage-sanitizers.js',
  'scripts/test-internal-tools-config.js',
  'scripts/test-insight-trend-visual.js',
  'scripts/test-item-insight-presentation.js',
  'scripts/test-insight-text.js',
  'scripts/test-summary-insight-change.js',
  'scripts/test-onboarding-flow.js',
  'scripts/test-provenance-presentation.js',
  'scripts/test-import-recovery-presentation.js',
  'scripts/test-password-recovery.js',
];

for (const relativePath of filesToCheck) {
  const absolutePath = path.join(projectRoot, relativePath);
  process.stdout.write(`[mobile-smoke] checking ${relativePath}\n`);
  execFileSync(process.execPath, ['--check', absolutePath], { stdio: 'inherit' });
  parser.parse(fs.readFileSync(absolutePath, 'utf8'), {
    sourceType: 'unambiguous',
    plugins: ['jsx'],
  });
}

const rootLayoutSource = fs.readFileSync(path.join(projectRoot, 'app/_layout.js'), 'utf8');
if (rootLayoutSource.includes("require('../assets/splash-icon.png')")) {
  throw new Error('[mobile-smoke] app/_layout.js must not render a second JavaScript splash logo');
}
for (const marker of ['initialSessionPromiseRef', 'initialUserCachePromiseRef']) {
  if (!rootLayoutSource.includes(marker)) {
    throw new Error(`[mobile-smoke] app/_layout.js is missing launch prewarm marker: ${marker}`);
  }
}

process.stdout.write('[mobile-smoke] syntax checks passed\n');
