jest.mock('../../src/models/itemFamilyLearning', () => ({
  findAssignments: jest.fn(),
  listPending: jest.fn(),
  loadCandidateEvidence: jest.fn(),
  loadCandidateGroups: jest.fn(),
  saveCandidates: jest.fn(),
}));

const ItemFamilyLearning = require('../../src/models/itemFamilyLearning');
const {
  buildItemFamilyCandidates,
  discoverItemFamilyCandidates,
  learnedFamilyKey,
  scoreLabelPair,
} = require('../../src/services/itemFamilyLearningService');

function repeatedRows(itemName, comparableKey, merchant = 'Market') {
  return ['2026-09-01', '2026-09-08'].map((date, index) => ({
    expense_item_id: `${comparableKey}-${index}`,
    comparable_key: comparableKey,
    item_name: itemName,
    merchant,
    date,
    category_group_name: 'Groceries',
    product_match_confidence: 'medium',
  }));
}

describe('itemFamilyLearningService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('scores a specific contained identity while normalizing common spelling variants', () => {
    expect(scoreLabelPair('Salmon Filet', 'Atlantic Salmon Fillet')).toMatchObject({
      signature: 'salmon filet',
      common_tokens: ['salmon', 'filet'],
    });
  });

  it('does not suggest a match from a flavor-level overlap', () => {
    expect(scoreLabelPair('Greek Yogurt Strawberry', 'Greek Yogurt Blueberry')).toBeNull();
  });

  it('does not treat a numeric SKU prefix plus a brand-only label as product evidence', () => {
    expect(scoreLabelPair('081229062 Mondo Llama', 'Mondo Llama')).toBeNull();
    expect(scoreLabelPair(
      'Stationery & Office Supplies 081228295 Mondo Llama',
      'Mondo Llama'
    )).toBeNull();
  });

  it.each([
    ['Chocolate Peanut Butter', 'Peanut Butter Chocolate Chip Bar'],
    ['Organic Strawberry', 'Strawberry Marshmallows'],
    ['Tomato', 'Tomato Soup'],
  ])('does not cross product-form boundaries: %s / %s', (left, right) => {
    expect(scoreLabelPair(left, right)).toBeNull();
  });

  it('builds a stable learned family from repeated high-similarity labels', () => {
    const candidates = buildItemFamilyCandidates([
      ...repeatedRows('Chicken Breast', 'chicken breast'),
      ...repeatedRows('Boneless Chicken Breast', 'boneless chicken breast', 'Warehouse Club'),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      left_item_key: 'boneless chicken breast',
      right_item_key: 'chicken breast',
      suggested_family_key: learnedFamilyKey('chicken breast'),
      suggested_family_name: 'Chicken Breast',
      family_signature: 'chicken breast',
      evidence: {
        left_occurrence_count: 2,
        right_occurrence_count: 2,
        common_tokens: ['chicken', 'breast'],
      },
    });
  });

  it('extends an existing learned family instead of creating a competing family', () => {
    const assignments = [{
      item_key: 'chicken breast',
      family_key: 'learned:chicken-breast:12345678',
      family_name: 'Chicken Breast',
      family_signature: 'chicken breast',
    }];
    const [candidate] = buildItemFamilyCandidates([
      ...repeatedRows('Chicken Breast', 'chicken breast'),
      ...repeatedRows('Boneless Chicken Breast', 'boneless chicken breast'),
    ], assignments);

    expect(candidate).toMatchObject({
      suggested_family_key: 'learned:chicken-breast:12345678',
      suggested_family_name: 'Chicken Breast',
      family_signature: 'chicken breast',
    });
  });

  it('does not prompt for labels already covered by the same seeded family', () => {
    const candidates = buildItemFamilyCandidates([
      ...repeatedRows('Organic Strawberries', 'organic strawberry'),
      ...repeatedRows('Strawberries 1 lb', 'strawberry'),
    ]);
    expect(candidates).toEqual([]);
  });

  it('does not use learning to bypass a seeded family exclusion', () => {
    const candidates = buildItemFamilyCandidates([
      ...repeatedRows('Organic Strawberry', 'organic strawberry'),
      repeatedRows('T Marshmallows Strawberry', 't marshmallow strawberry')[0],
    ]);
    expect(candidates).toEqual([]);
  });

  it('drops tax and prepared-beverage noise before candidate generation', () => {
    const candidates = buildItemFamilyCandidates([
      ...repeatedRows('Estimated Tax', 'estimated tax'),
      repeatedRows('Estimated sales tax', 'estimated sale tax')[0],
      ...repeatedRows('Iced Coffee', 'iced coffee'),
      repeatedRows('16oz Iced Coffee', '16oz iced coffee')[0],
    ]);
    expect(candidates).toEqual([]);
  });

  it('requires at least three combined observations with one repeated label', () => {
    expect(buildItemFamilyCandidates([
      repeatedRows('Chicken Breast', 'chicken breast')[0],
      repeatedRows('Boneless Chicken Breast', 'boneless chicken breast')[0],
    ])).toEqual([]);

    const candidates = buildItemFamilyCandidates([
      ...repeatedRows('Chicken Breast', 'chicken breast'),
      repeatedRows('Boneless Chicken Breast', 'boneless chicken breast')[0],
    ]);
    expect(candidates).toHaveLength(1);
  });

  it('uses aggregate observation counts and merchant evidence', () => {
    const candidates = buildItemFamilyCandidates([
      {
        ...repeatedRows('Chicken Breast', 'chicken breast')[0],
        occurrence_count: 4,
        merchants: ['Market', 'Warehouse Club', 'MARKET'],
        first_purchased_at: '2026-07-01',
        last_purchased_at: '2026-10-01',
        purchases: [{ expense_id: 'expense-1', merchant: 'Warehouse Club', date: '2026-10-01', amount: 8.99 }],
      },
      {
        ...repeatedRows('Boneless Chicken Breast', 'boneless chicken breast')[0],
        occurrence_count: 1,
        merchants: ['Market'],
      },
    ]);

    expect(candidates[0]).toMatchObject({
      evidence: {
        left_occurrence_count: 1,
        right_occurrence_count: 4,
        right_merchants: ['Market', 'Warehouse Club'],
        right_first_purchased_at: '2026-07-01',
        right_last_purchased_at: '2026-10-01',
        right_purchases: [{ expense_id: 'expense-1', merchant: 'Warehouse Club', date: '2026-10-01', amount: 8.99 }],
      },
    });
  });

  it('fetches rich evidence only after compact candidate selection', async () => {
    ItemFamilyLearning.loadCandidateGroups.mockResolvedValueOnce([
      { ...repeatedRows('Chicken Breast', 'chicken breast')[0], occurrence_count: 2, merchants: ['Market'] },
      { ...repeatedRows('Boneless Chicken Breast', 'boneless chicken breast')[0], occurrence_count: 1, merchants: ['Club'] },
    ]);
    ItemFamilyLearning.findAssignments.mockResolvedValueOnce([]);
    ItemFamilyLearning.loadCandidateEvidence.mockResolvedValueOnce([
      { comparable_key: 'chicken breast', purchases: [{ expense_id: 'expense-1' }] },
      { comparable_key: 'boneless chicken breast', purchases: [{ expense_id: 'expense-2' }] },
    ]);
    ItemFamilyLearning.saveCandidates.mockResolvedValueOnce([]);
    ItemFamilyLearning.listPending.mockResolvedValueOnce([{ id: 'candidate-1' }]);

    await expect(discoverItemFamilyCandidates({
      householdId: 'household-1',
      requesterUserId: 'user-1',
      limit: 12,
    })).resolves.toEqual([{ id: 'candidate-1' }]);

    expect(ItemFamilyLearning.loadCandidateEvidence).toHaveBeenCalledWith(
      'household-1',
      ['boneless chicken breast', 'chicken breast'],
      365
    );
    expect(ItemFamilyLearning.saveCandidates.mock.calls[0][1][0].evidence).toMatchObject({
      left_purchases: [{ expense_id: 'expense-2' }],
      right_purchases: [{ expense_id: 'expense-1' }],
    });
  });
});
