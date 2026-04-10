export function buildMockInsights(month) {
  return [
    {
      id: 'mock:household-price-spike',
      type: 'one_off_expense_skewing_projection',
      title: 'A one-off household stock-up is lifting the projection',
      body: 'Household spending still looks manageable, but one larger-than-usual pantry trip is pushing the all-in projection higher.',
      entity_type: 'budget',
      metadata: { scope: 'household', month },
    },
    {
      id: 'mock:personal-budget-fit',
      type: 'projected_month_end_over_budget',
      title: 'Your personal budget may be too low',
      body: 'You are projected to finish this month above budget, even after adjusting for your usual daily spending shape.',
      entity_type: 'budget',
      metadata: { scope: 'personal', month },
    },
    {
      id: 'mock:household-driver',
      type: 'top_category_driver',
      title: 'Groceries are driving the difference',
      body: 'Groceries are running about $86 higher than your usual household pace so far this period.',
      entity_type: 'category',
      metadata: { scope: 'household', month, category_key: 'groceries' },
    },
    {
      id: 'mock:projection-one-off',
      type: 'one_off_expense_skewing_projection',
      title: 'One unusual purchase is lifting the month-end projection',
      body: 'A larger-than-usual Costco stock-up is skewing the all-in projection above your baseline month.',
      entity_type: 'budget',
      metadata: { scope: 'personal', month },
    },
    {
      id: 'mock:long-early-card',
      type: 'early_spend_concentration',
      title: 'A longer early read should keep its action row pinned in place',
      body: 'This intentionally wordy card checks that the summary preview can absorb longer insight copy without pulling the footer away from the bottom of the card rail.',
      entity_type: 'expense',
      metadata: { scope: 'personal', month, maturity: 'early', confidence: 'descriptive' },
    },
  ];
}
