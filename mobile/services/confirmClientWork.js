import { insertExpenseIntoCachedLists, patchExpenseInCachedLists, saveExpenseSnapshot } from './expenseLocalStore';
import { invalidateExpenseMutationCaches } from './expenseMutationEffects';

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
        invalidateExpenseMutationCaches(),
        ...extraWork.map((work) =>
          Promise.resolve()
            .then(() => work?.())
            .catch(() => {})
        ),
      ]);
    })
    .catch(() => {});
}
