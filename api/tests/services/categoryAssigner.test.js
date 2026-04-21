// api/tests/services/categoryAssigner.test.js

// mockCreate is defined here and captured by the factory closure.
// Jest hoists jest.mock() above all statements, but the factory function
// is only *executed* when the module is first required — which happens
// after this variable is initialised (module load order: test file →
// factory runs → categoryAssigner.js is required → new Anthropic() is called).
// Using a plain object as a container so the factory always holds the same
// reference even though Jest hoisting moves the jest.mock() call up.
const mockCreateContainer = { fn: null };

jest.mock('@anthropic-ai/sdk', () => {
  const create = jest.fn().mockResolvedValue({
    content: [{ text: JSON.stringify({ category_id: 'cat-grocery-id', confidence: 'high' }) }]
  });
  mockCreateContainer.fn = create;
  return jest.fn().mockImplementation(() => ({
    messages: { create }
  }));
});

const { assignCategory } = require('../../src/services/categoryAssigner');
const MerchantMapping = require('../../src/models/merchantMapping');
const CategoryDecisionEvent = require('../../src/models/categoryDecisionEvent');
const db = require('../../src/db');

jest.mock('../../src/models/merchantMapping');
jest.mock('../../src/models/categoryDecisionEvent');

afterAll(() => db.pool.end());

const mockCategories = [
  { id: 'cat-grocery-id', name: 'Groceries' },
  { id: 'cat-gas-id', name: 'Gas' },
];

// Convenience getter resolved after factory has run
function mockCreate() {
  return mockCreateContainer.fn;
}

beforeEach(() => {
  MerchantMapping.findByMerchant.mockReset();
  CategoryDecisionEvent.findBestLearnedMatch.mockReset();
  CategoryDecisionEvent.findBestLearnedMatch.mockResolvedValue(null);
  mockCreate().mockReset();
  mockCreate().mockResolvedValue({
    content: [{ text: JSON.stringify({ category_id: 'cat-grocery-id', confidence: 'high' }) }]
  });
});

describe('assignCategory', () => {
  it('returns category from MerchantMapping when available', async () => {
    CategoryDecisionEvent.findBestLearnedMatch.mockResolvedValueOnce(null);
    MerchantMapping.findByMerchant.mockResolvedValueOnce({
      category_id: 'cat-grocery-id',
      hit_count: 7,
    });

    const result = await assignCategory({
      merchant: "Trader Joe's",
      householdId: 'hh-1',
      categories: mockCategories,
    });

    expect(result.category_id).toBe('cat-grocery-id');
    expect(result.source).toBe('memory');
    expect(result.confidence).toBe(4); // hit_count >= 5 → 4 dots
    expect(MerchantMapping.findByMerchant).toHaveBeenCalledWith('hh-1', "Trader Joe's");
  });

  it('falls back to Claude when no mapping exists', async () => {
    CategoryDecisionEvent.findBestLearnedMatch.mockResolvedValueOnce(null);
    MerchantMapping.findByMerchant.mockResolvedValueOnce(null);

    const result = await assignCategory({
      merchant: 'New Restaurant',
      householdId: 'hh-1',
      categories: mockCategories,
    });

    expect(result.category_id).toBe('cat-grocery-id');
    expect(result.source).toBe('claude');
    expect(result.confidence).toBe(1); // Claude fallback → 1 dot
  });

  it('uses local category heuristics before the Claude fallback', async () => {
    CategoryDecisionEvent.findBestLearnedMatch.mockResolvedValueOnce(null);
    MerchantMapping.findByMerchant.mockResolvedValueOnce(null);
    const callsBefore = mockCreate().mock.calls.length;

    const result = await assignCategory({
      merchant: null,
      description: 'lunch',
      householdId: 'hh-1',
      categories: [
        ...mockCategories,
        { id: 'cat-dining-id', name: 'Dining Out' },
      ],
    });

    expect(result).toEqual({
      category_id: 'cat-dining-id',
      source: 'heuristic',
      confidence: 2,
    });
    expect(mockCreate().mock.calls.length).toBe(callsBefore);
  });

  it('returns null category when Claude cannot determine', async () => {
    CategoryDecisionEvent.findBestLearnedMatch.mockResolvedValueOnce(null);
    MerchantMapping.findByMerchant.mockResolvedValueOnce(null);
    mockCreate().mockResolvedValueOnce({
      content: [{ text: JSON.stringify({ category_id: null, confidence: 'none' }) }]
    });

    const result = await assignCategory({
      merchant: 'Unknown Place',
      householdId: 'hh-1',
      categories: mockCategories,
    });

    expect(result.category_id).toBeNull();
    expect(result.source).toBe('claude');
    expect(result.confidence).toBe(1);
  });

  it('returns confidence 3 for hit_count between 2 and 4', async () => {
    CategoryDecisionEvent.findBestLearnedMatch.mockResolvedValueOnce(null);
    MerchantMapping.findByMerchant.mockResolvedValueOnce({
      category_id: 'cat-grocery-id',
      hit_count: 3,
    });
    const result = await assignCategory({
      merchant: "Some Store",
      householdId: 'hh-1',
      categories: mockCategories,
    });
    expect(result.confidence).toBe(3);
    expect(result.source).toBe('memory');
  });

  it('returns confidence 2 for hit_count of 1', async () => {
    CategoryDecisionEvent.findBestLearnedMatch.mockResolvedValueOnce(null);
    MerchantMapping.findByMerchant.mockResolvedValueOnce({
      category_id: 'cat-grocery-id',
      hit_count: 1,
    });
    const result = await assignCategory({
      merchant: "New Store",
      householdId: 'hh-1',
      categories: mockCategories,
    });
    expect(result.confidence).toBe(2);
    expect(result.source).toBe('memory');
  });

  it('prefers learned merchant+description decisions before merchant memory', async () => {
    CategoryDecisionEvent.findBestLearnedMatch.mockResolvedValueOnce({
      category_id: 'cat-gas-id',
      decision_count: 3,
      match_type: 'merchant_description',
    });
    MerchantMapping.findByMerchant.mockResolvedValueOnce({
      category_id: 'cat-grocery-id',
      hit_count: 7,
    });

    const result = await assignCategory({
      merchant: 'Shell',
      description: 'fill up before road trip',
      householdId: 'hh-1',
      categories: mockCategories,
    });

    expect(result).toEqual({
      category_id: 'cat-gas-id',
      source: 'decision_memory',
      confidence: 3,
    });
    expect(MerchantMapping.findByMerchant).not.toHaveBeenCalled();
  });

  it('can learn from repeated description-only corrections when merchant is missing', async () => {
    CategoryDecisionEvent.findBestLearnedMatch.mockResolvedValueOnce({
      category_id: 'cat-grocery-id',
      decision_count: 2,
      match_type: 'description',
    });

    const result = await assignCategory({
      merchant: null,
      description: 'bananas',
      householdId: 'hh-1',
      categories: mockCategories,
    });

    expect(result).toEqual({
      category_id: 'cat-grocery-id',
      source: 'description_memory',
      confidence: 3,
    });
  });
});
