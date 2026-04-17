import AsyncStorage from '@react-native-async-storage/async-storage';

const DETAIL_PREFIX = 'cache:expense-detail:';

export function expenseDetailKey(id) {
  return `${DETAIL_PREFIX}${id}`;
}

export async function saveExpenseSnapshot(expense) {
  if (!expense?.id) return;
  try {
    await AsyncStorage.setItem(
      expenseDetailKey(expense.id),
      JSON.stringify({ data: expense, ts: Date.now() })
    );
  } catch {
    // non-fatal
  }
}

export async function saveExpenseSnapshots(expenses) {
  if (!Array.isArray(expenses) || !expenses.length) return;
  try {
    const pairs = expenses
      .filter((expense) => expense?.id)
      .map((expense) => [
        expenseDetailKey(expense.id),
        JSON.stringify({ data: expense, ts: Date.now() }),
      ]);
    if (pairs.length) await AsyncStorage.multiSet(pairs);
  } catch {
    // non-fatal
  }
}

export async function removeExpenseSnapshot(id) {
  if (!id) return;
  try {
    await AsyncStorage.removeItem(expenseDetailKey(id));
  } catch {
    // non-fatal
  }
}

export async function loadExpenseSnapshot(id) {
  if (!id) return null;
  try {
    const raw = await AsyncStorage.getItem(expenseDetailKey(id));
    if (!raw) return null;
    const { data } = JSON.parse(raw);
    return data?.id === id ? data : null;
  } catch {
    return null;
  }
}

export async function loadExpenseItemsSnapshot(id) {
  const expense = await loadExpenseSnapshot(id);
  return Array.isArray(expense?.items) ? expense.items : null;
}

/**
 * Reconstruct a past-month expense list from individual detail snapshots.
 * Used as a fallback when the month-array cache is cold but detail snapshots exist.
 * Returns an array sorted newest-first, or null if no snapshots found.
 */
export async function loadExpenseSnapshotsForMonth(month) {
  if (!month) return null;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const detailKeys = keys.filter(k => k.startsWith(DETAIL_PREFIX));
    if (!detailKeys.length) return null;
    const pairs = await AsyncStorage.multiGet(detailKeys);
    const expenses = [];
    for (const [, raw] of pairs) {
      if (!raw) continue;
      try {
        const { data } = JSON.parse(raw);
        if (data?.date?.startsWith(month)) expenses.push(data);
      } catch {}
    }
    if (!expenses.length) return null;
    return expenses.sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch {
    return null;
  }
}

/**
 * Write-through helper: prepend a newly confirmed expense into all matching
 * month-array cache entries. Sets ts: 0 so TTL is bypassed and the cache
 * revalidates in the background on next load.
 */
export async function prependToExpenseMonthCaches(expense) {
  if (!expense?.id || !expense?.date) return;
  const month = expense.date.slice(0, 7); // YYYY-MM
  try {
    const keys = await AsyncStorage.getAllKeys();
    const monthKeys = keys.filter(k =>
      (k.startsWith('cache:expenses:') || k.startsWith('cache:household-expenses:')) &&
      k.includes(month)
    );
    for (const key of monthKeys) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) continue;
        const { data } = JSON.parse(raw);
        if (!Array.isArray(data)) continue;
        const already = data.some(e => e.id === expense.id);
        if (already) continue;
        await AsyncStorage.setItem(key, JSON.stringify({ data: [expense, ...data], ts: 0 }));
      } catch {}
    }
  } catch {}
}

export async function findExpenseSnapshotInCaches(id) {
  const direct = await loadExpenseSnapshot(id);
  if (direct) return direct;

  const directKeys = ['cache:expenses:pending'];
  for (const key of directKeys) {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;
      const { data } = JSON.parse(raw);
      if (!Array.isArray(data)) continue;
      const found = data.find((item) => item?.id === id);
      if (found) return found;
    } catch {
      // non-fatal
    }
  }

  try {
    const keys = await AsyncStorage.getAllKeys();
    const listKeys = keys.filter((key) => key.startsWith('cache:expenses:') || key.startsWith('cache:household-expenses:'));
    for (const key of listKeys) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) continue;
        const { data } = JSON.parse(raw);
        if (!Array.isArray(data)) continue;
        const found = data.find((item) => item?.id === id);
        if (found) return found;
      } catch {
        // keep searching
      }
    }
  } catch {
    // non-fatal
  }

  return null;
}
