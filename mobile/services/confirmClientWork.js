import { invalidateCacheByPrefix } from './cache';
import { insertExpenseIntoCachedLists, patchExpenseInCachedLists, saveExpenseSnapshot } from './expenseLocalStore';

export function queueConfirmedExpenseClientWork({
  expense = null,
  extraWork = [],
} = {}) {
  Promise.resolve()
    .then(async () => {
      if (expense?.id) {
        await saveExpenseSnapshot(expense);
        await insertExpenseIntoCachedLists(expense);
        await patchExpenseInCachedLists(expense);
      }

      await Promise.all([
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
        ...extraWork.map((work) =>
          Promise.resolve()
            .then(() => work?.())
            .catch(() => {})
        ),
      ]);
    })
    .catch(() => {});
}
