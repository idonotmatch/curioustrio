import { renderHook, act } from '@testing-library/react-native';
import { useCategories } from '../../hooks/useCategories';
import { mockCachePassthrough, mockCacheError } from './utils';

jest.mock('../../services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('../../services/cache', () => ({ loadWithCache: jest.fn() }));

const { api } = require('../../services/api');
const { loadWithCache } = require('../../services/cache');

beforeEach(() => {
  jest.clearAllMocks();
  mockCachePassthrough(loadWithCache);
});

const mockCategories = [
  { id: 'c-1', name: 'Groceries', icon: '🛒', color: '#4ade80' },
  { id: 'c-2', name: 'Dining Out', icon: '🍽️', color: '#f97316' },
];

describe('useCategories', () => {
  it('starts loading', () => {
    api.get.mockResolvedValue({ categories: [] });
    const { result } = renderHook(() => useCategories());
    expect(result.current.loading).toBe(true);
  });

  it('loads categories from /categories', async () => {
    api.get.mockResolvedValue({ categories: mockCategories });

    const { result } = renderHook(() => useCategories());
    await act(async () => {});

    expect(api.get).toHaveBeenCalledWith('/categories');
    expect(result.current.categories).toEqual(mockCategories);
    expect(result.current.loading).toBe(false);
  });

  it('returns empty array when API returns no categories key', async () => {
    api.get.mockResolvedValue({});

    const { result } = renderHook(() => useCategories());
    await act(async () => {});

    expect(result.current.categories).toEqual([]);
  });

  it('clears loading on error', async () => {
    mockCacheError(loadWithCache);

    const { result } = renderHook(() => useCategories());
    await act(async () => {});

    expect(result.current.loading).toBe(false);
    expect(result.current.categories).toEqual([]);
  });

  it('refresh re-fetches categories', async () => {
    api.get.mockResolvedValue({ categories: mockCategories });

    const { result } = renderHook(() => useCategories());
    await act(async () => {});
    await act(async () => { await result.current.refresh(); });

    expect(loadWithCache).toHaveBeenCalledTimes(2);
  });
});
