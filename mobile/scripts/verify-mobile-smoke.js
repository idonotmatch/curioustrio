const { execFileSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const filesToCheck = [
  'app/expense/[id].js',
  'app/insight-detail.js',
  'app/manual-add.js',
  'app/scenario-check.js',
  'components/PendingExpenseReviewPanel.js',
  'components/PendingExpenseEmailCard.js',
  'components/PendingExpenseApprovalCard.js',
  'components/PendingExpenseAttentionCard.js',
  'components/PendingExpenseItemsCard.js',
  'services/insightPresentation.js',
  'services/scenarioCheckPresentation.js',
];

for (const relativePath of filesToCheck) {
  const absolutePath = path.join(projectRoot, relativePath);
  process.stdout.write(`[mobile-smoke] checking ${relativePath}\n`);
  execFileSync(process.execPath, ['--check', absolutePath], { stdio: 'inherit' });
}

process.stdout.write('[mobile-smoke] syntax checks passed\n');
