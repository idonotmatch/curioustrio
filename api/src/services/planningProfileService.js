const ScenarioMemory = require('../models/scenarioMemory');

function strongTimingPreferenceStats(mode, timingPreferences = {}) {
  const stats = timingPreferences?.[mode];
  if (!stats) return null;
  const total = Number(stats.total || 0);
  const compareOptionCount = Number(stats.compare_option_count || 0);
  const followRate = Number(stats.follow_rate || 0);
  const netSignal = Number(stats.net_signal || 0);
  if (total < 3 || compareOptionCount < 2 || followRate < 0.75 || netSignal < 2) return null;
  return { total, compareOptionCount, followRate, netSignal };
}

async function loadTimingPreferences(userId) {
  if (!userId) return {};
  return ScenarioMemory.summarizeTimingPreferences(userId).catch(() => ({}));
}

function plannerRecommendationNote(mode, timingPreferences = {}) {
  if (!strongTimingPreferenceStats(mode, timingPreferences)) return null;
  switch (mode) {
    case 'next_period':
      return 'You usually prefer waiting when it clearly creates more room.';
    case 'spread_3_periods':
      return 'You usually prefer spreading purchases out when the pressure is close.';
    default:
      return 'You usually prefer keeping purchases in the current period when they still fit cleanly.';
  }
}

function watchTimingPreferenceNote(mode, timingPreferences = {}) {
  if (!strongTimingPreferenceStats(mode, timingPreferences)) return null;
  switch (mode) {
    case 'next_period':
      return 'You usually revisit these in the next period when room opens up.';
    case 'spread_3_periods':
      return 'You usually prefer spacing these out when the month is close.';
    default:
      return 'You usually keep these in the current period when they still fit cleanly.';
  }
}

function insightTimingPreferenceNote(type, timingPreferences = {}) {
  if (type === 'recurring_restock_window') {
    if (strongTimingPreferenceStats('next_period', timingPreferences)) {
      return 'You usually wait for the next period unless the need is immediate.';
    }
    if (strongTimingPreferenceStats('spread_3_periods', timingPreferences)) {
      return 'You usually prefer spacing purchases out when the month is close.';
    }
    if (strongTimingPreferenceStats('now', timingPreferences)) {
      return 'You usually act in the current period when something still fits cleanly.';
    }
  }

  if (type === 'recurring_repurchase_due') {
    if (strongTimingPreferenceStats('next_period', timingPreferences)) {
      return 'You usually wait a bit longer unless the item is due right away.';
    }
    if (strongTimingPreferenceStats('now', timingPreferences)) {
      return 'You usually handle due-soon staples in the current period.';
    }
  }

  if (type === 'buy_soon_better_price' || type === 'item_staple_merchant_opportunity') {
    if (strongTimingPreferenceStats('next_period', timingPreferences)) {
      return 'You usually wait for a cleaner budget window before stocking up.';
    }
    if (strongTimingPreferenceStats('now', timingPreferences)) {
      return 'You usually act on good timing when a staple is already in range.';
    }
  }

  return null;
}

module.exports = {
  loadTimingPreferences,
  strongTimingPreferenceStats,
  plannerRecommendationNote,
  watchTimingPreferenceNote,
  insightTimingPreferenceNote,
};
