import { renderHook, act } from '@testing-library/react-native';
import { useHouseholdExpenses } from '../../hooks/useHouseholdExpenses';
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
  { id: 'e-1', amount: '100.00', merchant: 'Costco' },
  { id: 'e-2', amount: '50.00', merchant: 'Target' },
];

describe('useHouseholdExpenses', () => {
  it('starts loading when enabled', () => {
    api.get.mockResolvedValue([]);
    const { result } = renderHook(() => useHouseholdExpenses());
    expect(result.current.loading).toBe(true);
  });

  it('does not load when disabled', async () => {
    const { result } = renderHook(() => useHouseholdExpenses(null, null, { enabled: false }));
    await act(async () => {});

    expect(result.current.loading).toBe(false);
    expect(result.current.expenses).toEqual([]);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('loads household expenses and calculates total', async () => {
    api.get.mockResolvedValue(mockExpenses);

    const { result } = renderHook(() => useHouseholdExpenses());
    await act(async () => {});

    expect(result.current.expenses).toEqual(mockExpenses);
    expect(result.current.total).toBe(150);
    expect(result.current.loading).toBe(false);
  });

  it('calls correct URL with params', async () => {
    api.get.mockResolvedValue([]);

    renderHook(() => useHouseholdExpenses('2026-04', 15));
    await act(async () => {});

    expect(api.get).toHaveBeenCalledWith('/expenses/household?month=2026-04&start_day=15');
  });

  it('sets error on network failure', async () => {
    mockCacheError(loadWithCache);

    const { result } = renderHook(() => useHouseholdExpenses());
    await act(async () => {});

    expect(result.current.error).toBe('Network error');
    expect(result.current.loading).toBe(false);
  });
});
