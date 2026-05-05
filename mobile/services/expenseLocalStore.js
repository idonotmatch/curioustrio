import AsyncStorage from '@react-native-async-storage/async-storage';

const {
  sanitizeExpenseCollection,
  sanitizeExpenseItems,
  sanitizeExpenseSnapshot,
} = require('./storageSanitizers');

const DETAIL_PREFIX = 'cache:expense-detail:';
const ITEM_PREFIX = 'cache:expense-items:';

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function isPresent(value) {
  return value !== undefined && value !== null;
}

function mergeExpenseData(existing = {}, incoming = {}) {
  if (!existing?.id) return incoming;
  if (!incoming?.id) return existing;

  const merged = {
    ...existing,
    ...incoming,
  };

  for (const [key, value] of Object.entries(existing)) {
    if (hasOwn(incoming, key)) continue;
    merged[key] = value;
  }

  if (!hasOwn(incoming, 'items') && Array.isArray(existing.items)) {
    merged.items = existing.items;
  }

  if (!hasOwn(incoming, 'item_count')) {
    if (Array.isArray(merged.items)) {
      merged.item_count = merged.items.length;
    } else if (isPresent(existing.item_count)) {
      merged.item_count = existing.item_count;
    }
  }

  if (hasOwn(incoming, 'items') && Array.isArray(incoming.items) && !hasOwn(incoming, 'item_count')) {
    merged.item_count = incoming.items.length;
  }

  if (!hasOwn(incoming, 'duplicate_flags') && Array.isArray(existing.duplicate_flags)) {
    merged.duplicate_flags = existing.duplicate_flags;
  }

  if (!isPresent(incoming.category_reasoning) && isPresent(existing.category_reasoning)) {
    merged.category_reasoning = existing.category_reasoning;
  }

  return merged;
}

function isSamePayload(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function expenseDetailKey(id) {
  return `${DETAIL_PREFIX}${id}`;
}

export function expenseItemsKey(id) {
  return `${ITEM_PREFIX}${id}`;
}

export async function saveExpenseItemsSnapshot(id, items) {
  if (!id || !Array.isArray(items)) return;
  try {
    const sanitizedItems = sanitizeExpenseItems(items);
    await AsyncStorage.setItem(
      expenseItemsKey(id),
      JSON.stringify({ data: sanitizedItems, ts: Date.now() })
    );
  } catch {
    // non-fatal
  }
}

export async function saveExpenseSnapshot(expense) {
  const sanitizedExpense = sanitizeExpenseSnapshot(expense);
  if (!sanitizedExpense?.id) return;
  try {
    const existing = await loadExpenseSnapshot(sanitizedExpense.id);
    const nextExpense = mergeExpenseData(existing || {}, sanitizedExpense);
    if (Array.isArray(nextExpense.items)) {
      await saveExpenseItemsSnapshot(nextExpense.id, nextExpense.items);
    }
    await AsyncStorage.setItem(
      expenseDetailKey(nextExpense.id),
      JSON.stringify({ data: nextExpense, ts: Date.now() })
    );
  } catch {
    // non-fatal
  }
}

export async function saveExpenseSnapshots(expenses) {
  if (!Array.isArray(expenses) || !expenses.length) return;
  try {
    const validExpenses = sanitizeExpenseCollection(expenses);
    if (!validExpenses.length) return;

    const keys = validExpenses.map((expense) => expenseDetailKey(expense.id));
    const existingPairs = await AsyncStorage.multiGet(keys);
    const existingByKey = new Map(existingPairs);
    const pairs = validExpenses.map((expense) => {
      let existing = null;
      const raw = existingByKey.get(expenseDetailKey(expense.id));
      if (raw) {
        try {
          existing = sanitizeExpenseSnapshot(JSON.parse(raw)?.data || null);
        } catch {
          existing = null;
        }
      }
      const nextExpense = mergeExpenseData(existing || {}, expense);
      return [
        expenseDetailKey(nextExpense.id),
        JSON.stringify({ data: nextExpense, ts: Date.now() }),
      ];
    });
    if (pairs.length) await AsyncStorage.multiSet(pairs);
  } catch {
    // non-fatal
  }
}

export async function removeExpenseSnapshot(id) {
  if (!id) return;
  try {
    await AsyncStorage.multiRemove([expenseDetailKey(id), expenseItemsKey(id)]);
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
    const sanitized = sanitizeExpenseSnapshot(data);
    if (sanitized?.id === id) {
      if (!isSamePayload(sanitized, data)) {
        AsyncStorage.setItem(expenseDetailKey(id), JSON.stringify({ data: sanitized, ts: Date.now() })).catch(() => {});
      }
      return sanitized;
    }
    return null;
  } catch {
    return null;
  }
}

export async function loadExpenseItemsSnapshot(id, { maxAgeMs = null, includeMeta = false } = {}) {
  if (!id) return includeMeta ? { items: null, isFresh: false, ts: null, ageMs: null } : null;

  try {
    const raw = await AsyncStorage.getItem(expenseItemsKey(id));
    if (raw) {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed?.data) ? sanitizeExpenseItems(parsed.data) : null;
      const ts = Number(parsed?.ts) || null;
      const ageMs = ts ? Math.max(0, Date.now() - ts) : null;
      const isFresh = maxAgeMs == null ? !!items : ageMs != null && ageMs <= maxAgeMs;
      if (items) {
        if (!isSamePayload(items, parsed?.data || null)) {
          AsyncStorage.setItem(expenseItemsKey(id), JSON.stringify({ data: items, ts: Date.now() })).catch(() => {});
        }
        return includeMeta ? { items, isFresh, ts, ageMs } : items;
      }
    }
  } catch {
    // non-fatal
  }

  const expense = await findExpenseSnapshotInCaches(id);
  const items = Array.isArray(expense?.items) ? expense.items : null;
  if (items) {
    await saveExpenseItemsSnapshot(id, items);
  }
  return includeMeta
    ? { items, isFresh: false, ts: null, ageMs: null }
    : items;
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
      const found = sanitizeExpenseCollection(data).find((item) => item?.id === id);
      if (found) {
        saveExpenseSnapshot(found);
        return found;
      }
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
        const found = sanitizeExpenseCollection(data).find((item) => item?.id === id);
        if (found) {
          saveExpenseSnapshot(found);
          return found;
        }
      } catch {
        // keep searching
      }
    }
  } catch {
    // non-fatal
  }

  return null;
}

export async function mergeExpenseSnapshot(expense) {
  return saveExpenseSnapshot(expense);
}

export { mergeExpenseData };

async function listCacheKeys() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys.filter((key) =>
      key === 'cache:expenses:pending'
      || key.startsWith('cache:expenses:')
      || key.startsWith('cache:household-expenses:')
    );
  } catch {
    return [];
  }
}

function cacheAllowsExpense(key, expense) {
  const dateValue = `${expense?.date || ''}`.slice(0, 10);
  const fallbackMonth = dateValue.slice(0, 7);

  function periodMonthForDate(startDay = 1) {
    if (!dateValue || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return fallbackMonth;
    const [year, month, day] = dateValue.split('-').map(Number);
    if (!year || !month || !day) return fallbackMonth;
    if ((startDay || 1) <= 1 || day >= startDay) {
      return `${year}-${String(month).padStart(2, '0')}`;
    }
    const prev = new Date(year, month - 2, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  }

  if (key === 'cache:expenses:pending') {
    return expense?.status === 'pending';
  }

  if (key.startsWith('cache:expenses:')) {
    const [, , scopedMonth, scopedStartDay] = key.split(':');
    const startDay = Number(scopedStartDay) || 1;
    const periodMonth = periodMonthForDate(startDay);
    return scopedMonth === 'all' || (periodMonth && scopedMonth === periodMonth);
  }

  if (key.startsWith('cache:household-expenses:')) {
    const [, , scopedMonth, scopedStartDay] = key.split(':');
    const startDay = Number(scopedStartDay) || 1;
    const periodMonth = periodMonthForDate(startDay);
    return scopedMonth === 'all' || (periodMonth && scopedMonth === periodMonth);
  }

  return false;
}

export async function patchExpenseInCachedLists(expense) {
  const sanitizedExpense = sanitizeExpenseSnapshot(expense);
  if (!sanitizedExpense?.id) return;
  try {
    const keys = await listCacheKeys();
    if (!keys.length) return;

    const entries = await AsyncStorage.multiGet(keys);
    const updates = [];

    for (const [key, raw] of entries) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const data = Array.isArray(parsed?.data) ? sanitizeExpenseCollection(parsed.data) : null;
        if (!data) continue;
        let touched = false;
        const nextData = data.map((item) => {
          if (item?.id !== sanitizedExpense.id) return item;
          touched = true;
          return mergeExpenseData(item || {}, sanitizedExpense);
        });
        if (touched) {
          updates.push([key, JSON.stringify({ ...parsed, data: nextData, ts: Date.now() })]);
        }
      } catch {
        // non-fatal
      }
    }

    if (updates.length) {
      await AsyncStorage.multiSet(updates);
    }
  } catch {
    // non-fatal
  }
}

export async function removeExpenseFromCachedLists(id) {
  if (!id) return;
  try {
    const keys = await listCacheKeys();
    if (!keys.length) return;

    const entries = await AsyncStorage.multiGet(keys);
    const updates = [];

    for (const [key, raw] of entries) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const data = Array.isArray(parsed?.data) ? sanitizeExpenseCollection(parsed.data) : null;
        if (!data) continue;
        const nextData = data.filter((item) => item?.id !== id);
        if (nextData.length !== data.length) {
          updates.push([key, JSON.stringify({ ...parsed, data: nextData, ts: Date.now() })]);
        }
      } catch {
        // non-fatal
      }
    }

    if (updates.length) {
      await AsyncStorage.multiSet(updates);
    }
  } catch {
    // non-fatal
  }
}

export async function insertExpenseIntoCachedLists(expense) {
  const sanitizedExpense = sanitizeExpenseSnapshot(expense);
  if (!sanitizedExpense?.id) return;
  try {
    const keys = await listCacheKeys();
    if (!keys.length) return;

    const entries = await AsyncStorage.multiGet(keys);
    const updates = [];

    for (const [key, raw] of entries) {
      if (!raw || !cacheAllowsExpense(key, sanitizedExpense)) continue;
      try {
        const parsed = JSON.parse(raw);
        const data = Array.isArray(parsed?.data) ? sanitizeExpenseCollection(parsed.data) : null;
        if (!data) continue;
        const existingIndex = data.findIndex((item) => item?.id === sanitizedExpense.id);
        let nextData = data;

        if (existingIndex >= 0) {
          nextData = [...data];
          nextData[existingIndex] = mergeExpenseData(nextData[existingIndex] || {}, sanitizedExpense);
        } else {
          nextData = [sanitizedExpense, ...data];
        }

        updates.push([key, JSON.stringify({ ...parsed, data: nextData, ts: Date.now() })]);
      } catch {
        // non-fatal
      }
    }

    if (updates.length) {
      await AsyncStorage.multiSet(updates);
    }
  } catch {
    // non-fatal
  }
}
