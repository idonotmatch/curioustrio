const { execFileSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const filesToCheck = [
  'app/_layout.js',
  'app/accounts.js',
  'app/confirm.js',
  'app/expense/[id].js',
  'app/gmail-import.js',
  'app/insight-diagnostics.js',
  'app/login.js',
  'app/insight-detail.js',
  'app/manual-add.js',
  'app/onboarding.js',
  'app/scenario-check.js',
  'app/watching-plans.js',
  'app/(tabs)/settings.js',
  'app/(tabs)/summary.js',
  'components/GlobalAddLauncher.js',
  'components/NLInput.js',
  'components/GmailImportOverview.js',
  'components/PendingExpenseReviewPanel.js',
  'components/PendingExpenseEmailCard.js',
  'components/PendingExpenseApprovalCard.js',
  'components/PendingExpenseAttentionCard.js',
  'components/PendingExpenseItemsCard.js',
  'components/SmartSuggestionCard.js',
  'services/insightPresentation.js',
  'services/manualAddSuggestions.js',
  'services/confirmClientWork.js',
  'services/confirmNavigation.js',
  'services/currentUserCache.js',
  'services/scenarioCheckPresentation.js',
];

for (const relativePath of filesToCheck) {
  const absolutePath = path.join(projectRoot, relativePath);
  process.stdout.write(`[mobile-smoke] checking ${relativePath}\n`);
  execFileSync(process.execPath, ['--check', absolutePath], { stdio: 'inherit' });
}

process.stdout.write('[mobile-smoke] syntax checks passed\n');
