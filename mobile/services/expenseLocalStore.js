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
