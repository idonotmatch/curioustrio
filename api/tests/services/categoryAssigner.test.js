// api/tests/services/categoryAssigner.test.js
const { assignCategory } = require('../../src/services/categoryAssigner');
const MerchantMapping = require('../../src/models/merchantMapping');
const db = require('../../src/db');

jest.mock('../../src/models/merchantMapping');
jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn().mockResolvedValue({
    content: [{ text: JSON.stringify({ category_id: 'cat-grocery-id', confidence: 'high' }) }]
  });
  const MockAnthropic = jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate }
  }));
  MockAnthropic._mockCreate = mockCreate;
  return MockAnthropic;
});

afterAll(() => db.pool.end());

const mockCategories = [
  { id: 'cat-grocery-id', name: 'Groceries' },
  { id: 'cat-gas-id', name: 'Gas' },
];

describe('assignCategory', () => {
  it('returns category from MerchantMapping when available', async () => {
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

  it('returns null category when Claude cannot determine', async () => {
    MerchantMapping.findByMerchant.mockResolvedValueOnce(null);
    const Anthropic = require('@anthropic-ai/sdk');
    Anthropic._mockCreate.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({ category_id: null, confidence: 'none' }) }]
    });

    const result = await assignCategory({
      merchant: 'Unknown Place',
      householdId: 'hh-1',
      categories: mockCategories,
    });

    expect(result.category_id).toBeNull();
  });
});
