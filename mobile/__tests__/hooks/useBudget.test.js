import { renderHook, act } from '@testing-library/react-native';
import { useBudget } from '../../hooks/useBudget';
import { mockCachePassthrough } from './utils';

jest.mock('../../services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('../../services/cache', () => ({
  loadWithCache: jest.fn(),
  loadCacheOnly: jest.fn(),
}));

const { api } = require('../../services/api');
const { loadWithCache, loadCacheOnly } = require('../../services/cache');

beforeEach(() => {
  jest.clearAllMocks();
  mockCachePassthrough(loadWithCache, loadCacheOnly);
});

const mockBudget = { total: 2000, spent: 850, remaining: 1150, categories: [] };

describe('useBudget', () => {
  it('starts loading when enabled', () => {
    api.get.mockResolvedValue(mockBudget);
    const { result } = renderHook(() => useBudget('2026-04', 'personal'));
    expect(result.current.loading).toBe(true);
  });

  it('does not load when disabled', async () => {
    const { result } = renderHook(() => useBudget('2026-04', 'personal', { enabled: false }));
    await act(async () => {});

    expect(result.current.loading).toBe(false);
    expect(result.current.budget).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('loads budget and clears loading', async () => {
    api.get.mockResolvedValue(mockBudget);

    const { result } = renderHook(() => useBudget('2026-04', 'personal'));
    await act(async () => {});

    expect(result.current.budget).toEqual(mockBudget);
    expect(result.current.loading).toBe(false);
  });

  it('calls API with month, scope, and start_day params', async () => {
    api.get.mockResolvedValue(mockBudget);

    renderHook(() => useBudget('2026-04', 'household', { startDayOverride: 15 }));
    await act(async () => {});

    expect(api.get).toHaveBeenCalledWith('/budgets?month=2026-04&scope=household&start_day=15');
  });

  it('uses loadCacheOnly when cacheOnly is true', async () => {
    api.get.mockResolvedValue(mockBudget);

    renderHook(() => useBudget('2026-04', 'personal', { cacheOnly: true }));
    await act(async () => {});

    expect(loadCacheOnly).toHaveBeenCalled();
    expect(loadWithCache).not.toHaveBeenCalled();
  });

  it('uses loadWithCache when cacheOnly is false', async () => {
    api.get.mockResolvedValue(mockBudget);

    renderHook(() => useBudget('2026-04', 'personal', { cacheOnly: false }));
    await act(async () => {});

    expect(loadWithCache).toHaveBeenCalled();
    expect(loadCacheOnly).not.toHaveBeenCalled();
  });
});
