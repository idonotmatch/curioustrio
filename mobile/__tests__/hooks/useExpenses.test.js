import { renderHook, act } from '@testing-library/react-native';
import { useExpenses } from '../../hooks/useExpenses';
import { mockCachePassthrough, mockCacheError } from './utils';

jest.mock('../../services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('../../services/cache', () => ({ loadWithCache: jest.fn() }));
jest.mock('../../services/expenseLocalStore', () => ({ saveExpenseSnapshots: jest.fn() }));

const { api } = require('../../services/api');
const { loadWithCache } = require('../../services/cache');

beforeEach(() => {
  jest.clearAllMocks();
  mockCachePassthrough(loadWithCache);
});

const mockExpenses = [
  { id: 'e-1', merchant: 'Whole Foods', amount: '45.00', date: '2026-04-01' },
  { id: 'e-2', merchant: 'Starbucks', amount: '6.50', date: '2026-04-02' },
];

describe('useExpenses', () => {
  it('starts loading', () => {
    api.get.mockResolvedValue([]);
    const { result } = renderHook(() => useExpenses());
    expect(result.current.loading).toBe(true);
  });

  it('loads expenses and clears loading', async () => {
    api.get.mockResolvedValue(mockExpenses);

    const { result } = renderHook(() => useExpenses());
    await act(async () => {});

    expect(result.current.expenses).toEqual(mockExpenses);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('calls API with month and start_day params', async () => {
    api.get.mockResolvedValue([]);

    renderHook(() => useExpenses('2026-04', 15));
    await act(async () => {});

    expect(api.get).toHaveBeenCalledWith('/expenses?month=2026-04&start_day=15');
  });

  it('calls API without params when none provided', async () => {
    api.get.mockResolvedValue([]);

    renderHook(() => useExpenses());
    await act(async () => {});

    expect(api.get).toHaveBeenCalledWith('/expenses');
  });

  it('sets error on network failure', async () => {
    mockCacheError(loadWithCache);

    const { result } = renderHook(() => useExpenses());
    await act(async () => {});

    expect(result.current.error).toBe('Network error');
    expect(result.current.loading).toBe(false);
    expect(result.current.expenses).toEqual([]);
  });

  it('refresh re-fetches data', async () => {
    api.get.mockResolvedValue(mockExpenses);

    const { result } = renderHook(() => useExpenses());
    await act(async () => {});
    await act(async () => { result.current.refresh(); });

    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
