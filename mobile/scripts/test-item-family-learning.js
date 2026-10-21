const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const reviewSource = fs.readFileSync(path.join(projectRoot, 'app/item-family-review.js'), 'utf8');
const trendsSource = fs.readFileSync(path.join(projectRoot, 'app/item-trends.js'), 'utf8');

for (const marker of [
  '/recurring/item-family-suggestions?limit=12',
  "decision: 'undo'",
  "onReview(candidate, 'different')",
  "onReview(candidate, 'same')",
  "invalidateCacheByPrefix('cache:item-trends:')",
  "invalidateCacheByPrefix('cache:recurring-item:')",
  'refreshInsightsAfterFeedback()',
  'No matches to review',
]) {
  if (!reviewSource.includes(marker)) {
    throw new Error(`[item-family-learning] review screen is missing: ${marker}`);
  }
}

if (!trendsSource.includes("router.push('/item-family-review')")) {
  throw new Error('[item-family-learning] item trends must link to match review');
}

process.stdout.write('[mobile-logic] item family learning checks passed\n');
