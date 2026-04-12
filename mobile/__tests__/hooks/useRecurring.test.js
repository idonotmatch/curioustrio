import { renderHook, act } from '@testing-library/react-native';
import { useRecurring } from '../../hooks/useRecurring';
import { mockCachePassthrough, mockCacheError } from './utils';

jest.mock('../../services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('../../services/cache', () => ({ loadWithCache: jest.fn() }));

const { api } = require('../../services/api');
const { loadWithCache } = require('../../services/cache');

beforeEach(() => {
  jest.clearAllMocks();
  mockCachePassthrough(loadWithCache);
});

const mockRecurring = [
  { id: 'r-1', merchant: 'Netflix', frequency: 'monthly', next_due: '2026-05-01' },
  { id: 'r-2', merchant: 'Spotify', frequency: 'monthly', next_due: '2026-05-03' },
];

describe('useRecurring', () => {
  it('starts loading', () => {
    api.get.mockResolvedValue([]);
    const { result } = renderHook(() => useRecurring());
    expect(result.current.loading).toBe(true);
  });

  it('loads recurring items from /recurring', async () => {
    api.get.mockResolvedValue(mockRecurring);

    const { result } = renderHook(() => useRecurring());
    await act(async () => {});

    expect(api.get).toHaveBeenCalledWith('/recurring');
    expect(result.current.recurring).toEqual(mockRecurring);
    expect(result.current.loading).toBe(false);
  });

  it('defaults to empty array on null response', async () => {
    api.get.mockResolvedValue(null);

    const { result } = renderHook(() => useRecurring());
    await act(async () => {});

    expect(result.current.recurring).toEqual([]);
  });

  it('defaults to empty array on error', async () => {
    mockCacheError(loadWithCache);

    const { result } = renderHook(() => useRecurring());
    await act(async () => {});

    expect(result.current.recurring).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('refresh re-fetches recurring items', async () => {
    api.get.mockResolvedValue(mockRecurring);

    const { result } = renderHook(() => useRecurring());
    await act(async () => {});
    await act(async () => { await result.current.refresh(); });

    expect(loadWithCache).toHaveBeenCalledTimes(2);
  });
});
