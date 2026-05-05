import {
  findExpenseSnapshotInCaches,
  loadExpenseItemsSnapshot,
  mergeExpenseData,
} from './expenseLocalStore';
import {
  createEditableExpenseItem,
  normalizeExpenseItemPayload,
} from './itemEditing';

export const ITEM_CACHE_FRESH_MS = 10 * 60 * 1000;

export function parseExpenseParam(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function createExpenseSetters(setters) {
  return {
    setExpense: setters.setExpense,
    setMerchant: setters.setMerchant,
    setAmount: setters.setAmount,
    setDate: setters.setDate,
    setNotes: setters.setNotes,
    setCategoryId: setters.setCategoryId,
    setPaymentMethod: setters.setPaymentMethod,
    setCardLast4: setters.setCardLast4,
    setCardLabel: setters.setCardLabel,
    setIsPrivate: setters.setIsPrivate,
    setExcludeFromBudget: setters.setExcludeFromBudget,
    setBudgetExclusionReason: setters.setBudgetExclusionReason,
    setItems: setters.setItems,
    setLocationData: setters.setLocationData,
    setItemsEdits: setters.setItemsEdits,
  };
}

export function applyExpenseToState(record, setters) {
  if (!record) return;
  setters.setExpense(record);
  setters.setMerchant(record.merchant || '');
  setters.setAmount(String(Math.abs(Number(record.amount))));
  setters.setDate(record.date ? record.date.slice(0, 10) : '');
  setters.setNotes(record.notes || '');
  setters.setCategoryId(record.category_id || null);
  setters.setPaymentMethod(record.payment_method || 'unknown');
  setters.setCardLast4(record.card_last4 || '');
  setters.setCardLabel(record.card_label || '');
  setters.setIsPrivate(record.is_private || false);
  setters.setExcludeFromBudget(record.exclude_from_budget || false);
  setters.setBudgetExclusionReason(record.budget_exclusion_reason || null);
  setters.setItems(record.items || []);
  setters.setLocationData(
    record.place_name || record.address || record.mapkit_stable_id
      ? {
          place_name: record.place_name || '',
          address: record.address || null,
          mapkit_stable_id: record.mapkit_stable_id || null,
        }
      : null
  );
  setters.setItemsEdits((record.items || []).map((it) => ({
    ...createEditableExpenseItem(it),
  })));
}

export function mergeReviewMetadata(previous, next) {
  if (!next) return previous || null;
  if (!previous) return next;
  return mergeExpenseData(previous, next);
}

export async function bootstrapExpenseRecord(id, expenseParam) {
  const routeExpense = parseExpenseParam(typeof expenseParam === 'string' ? expenseParam : null);
  const bootstrapped = routeExpense || await findExpenseSnapshotInCaches(id);
  const cachedItems = await loadExpenseItemsSnapshot(id, {
    maxAgeMs: ITEM_CACHE_FRESH_MS,
    includeMeta: true,
  });
  if (bootstrapped && cachedItems?.items && !Array.isArray(bootstrapped.items)) {
    return {
      ...bootstrapped,
      items: cachedItems.items,
      item_count: cachedItems.items.length,
    };
  }
  return bootstrapped;
}

export function buildExpensePatchPayload({
  merchant,
  amount,
  date,
  notes,
  categoryId,
  paymentMethod,
  cardLast4,
  cardLabel,
  isPrivate,
  excludeFromBudget,
  budgetExclusionReason,
  locationData,
  itemsEdits,
}) {
  return {
    merchant,
    amount: parseFloat(amount),
    date,
    notes,
    category_id: categoryId,
    payment_method: paymentMethod,
    card_last4: cardLast4 || null,
    card_label: cardLabel || null,
    is_private: isPrivate,
    exclude_from_budget: excludeFromBudget,
    budget_exclusion_reason: excludeFromBudget ? budgetExclusionReason : null,
    place_name: locationData?.place_name || null,
    address: locationData?.address || null,
    mapkit_stable_id: locationData?.mapkit_stable_id || null,
    items: itemsEdits
      .filter((it) => it.description.trim())
      .map((it) => normalizeExpenseItemPayload(it)),
  };
}
