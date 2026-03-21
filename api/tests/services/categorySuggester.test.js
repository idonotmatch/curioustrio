// api/tests/services/categorySuggester.test.js
jest.mock('../../src/services/ai');
const ai = require('../../src/services/ai');
const Category = require('../../src/models/category');
const CategorySuggestion = require('../../src/models/categorySuggestion');
const { suggest } = require('../../src/services/categorySuggester');

const HOUSEHOLD = 'hh-test-suggester';
const PARENT_ID = 'parent-uuid-001';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Category, 'findByHousehold').mockResolvedValue([
    { id: PARENT_ID,    name: 'Food',       parent_id: null, household_id: HOUSEHOLD },
    { id: 'leaf-uuid-1', name: 'Groceries',  parent_id: null, household_id: HOUSEHOLD },
    { id: 'leaf-uuid-2', name: 'Dining Out', parent_id: null, household_id: HOUSEHOLD },
  ]);
  jest.spyOn(CategorySuggestion, 'upsertForLeaf').mockResolvedValue();
});

describe('suggest', () => {
  it('calls AI and stores results for matching leaves', async () => {
    ai.complete.mockResolvedValue(
      '[{"leaf_id":"leaf-uuid-1","parent_id":"parent-uuid-001"},{"leaf_id":"leaf-uuid-2","parent_id":"parent-uuid-001"}]'
    );

    await suggest(HOUSEHOLD, PARENT_ID);

    expect(ai.complete).toHaveBeenCalledTimes(1);
    const call = ai.complete.mock.calls[0][0];
    expect(call.messages[0].content).toContain('Groceries');
    expect(call.messages[0].content).toContain('Dining Out');

    expect(CategorySuggestion.upsertForLeaf).toHaveBeenCalledWith(HOUSEHOLD, 'leaf-uuid-1', PARENT_ID);
    expect(CategorySuggestion.upsertForLeaf).toHaveBeenCalledWith(HOUSEHOLD, 'leaf-uuid-2', PARENT_ID);
  });

  it('does nothing when no unassigned leaves exist', async () => {
    jest.spyOn(Category, 'findByHousehold').mockResolvedValue([
      { id: PARENT_ID, name: 'Food', parent_id: null, household_id: HOUSEHOLD },
    ]);

    await suggest(HOUSEHOLD, PARENT_ID);

    expect(ai.complete).not.toHaveBeenCalled();
    expect(CategorySuggestion.upsertForLeaf).not.toHaveBeenCalled();
  });

  it('is non-fatal — resolves even if AI throws', async () => {
    ai.complete.mockRejectedValue(new Error('AI down'));
    await expect(suggest(HOUSEHOLD, PARENT_ID)).resolves.toBeUndefined();
  });

  it('is non-fatal — resolves even if JSON is unparseable', async () => {
    ai.complete.mockResolvedValue('not valid json');
    await expect(suggest(HOUSEHOLD, PARENT_ID)).resolves.toBeUndefined();
  });
});
