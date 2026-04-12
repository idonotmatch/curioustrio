import { renderHook, act } from '@testing-library/react-native';
import { mockCachePassthrough, mockCacheError } from './utils';

jest.mock('../../services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('../../services/cache', () => ({ loadWithCache: jest.fn() }));
jest.mock('../../services/expenseLocalStore', () => ({ saveExpenseSnapshots: jest.fn() }));
jest.mock('../../fixtures/mockGmailImport', () => ({
  buildMockPendingExpenses: () => [],
}));

const { api } = require('../../services/api');
const { loadWithCache } = require('../../services/cache');

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  mockCachePassthrough(loadWithCache);
});

const mockPending = [
  { id: 'p-1', merchant: 'Amazon', amount: '29.99', status: 'pending' },
  { id: 'p-2', merchant: 'Target', amount: '55.00', status: 'pending' },
];

describe('usePendingExpenses', () => {
  it('starts loading', () => {
    api.get.mockResolvedValue([]);
    const { usePendingExpenses } = require('../../hooks/usePendingExpenses');
    const { result } = renderHook(() => usePendingExpenses());
    expect(result.current.loading).toBe(true);
  });

  it('loads pending expenses and clears loading', async () => {
    api.get.mockResolvedValue(mockPending);
    const { usePendingExpenses } = require('../../hooks/usePendingExpenses');

    const { result } = renderHook(() => usePendingExpenses());
    await act(async () => {});

    expect(api.get).toHaveBeenCalledWith('/expenses/pending');
    expect(result.current.expenses).toEqual(mockPending);
    expect(result.current.loading).toBe(false);
  });

  it('removePendingExpense removes by id from shared state', async () => {
    api.get.mockResolvedValue(mockPending);
    const { usePendingExpenses, removePendingExpense } = require('../../hooks/usePendingExpenses');

    const { result } = renderHook(() => usePendingExpenses());
    await act(async () => {});
    act(() => { removePendingExpense('p-1'); });

    expect(result.current.expenses.find(e => e.id === 'p-1')).toBeUndefined();
    expect(result.current.expenses).toHaveLength(1);
  });

  it('sets error on network failure', async () => {
    mockCacheError(loadWithCache);
    const { usePendingExpenses } = require('../../hooks/usePendingExpenses');

    const { result } = renderHook(() => usePendingExpenses());
    await act(async () => {});

    expect(result.current.error).toBe('Network error');
    expect(result.current.loading).toBe(false);
  });
});
