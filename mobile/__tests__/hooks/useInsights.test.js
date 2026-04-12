import { renderHook, act } from '@testing-library/react-native';
import { useInsights } from '../../hooks/useInsights';
import { mockCachePassthrough } from './utils';

jest.mock('../../services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../services/cache', () => ({
  loadWithCache: jest.fn(),
  invalidateCacheByPrefix: jest.fn(),
}));

const { api } = require('../../services/api');
const { loadWithCache, invalidateCacheByPrefix } = require('../../services/cache');

beforeEach(() => {
  jest.clearAllMocks();
  mockCachePassthrough(loadWithCache);
  api.post.mockResolvedValue({});
  invalidateCacheByPrefix.mockResolvedValue();
});

const mockInsights = [
  { id: 'i-1', type: 'price_spike', title: 'Coffee up 20%', severity: 'medium' },
  { id: 'i-2', type: 'recurring_due', title: 'Netflix due soon', severity: 'low' },
];

describe('useInsights', () => {
  it('starts loading', () => {
    api.get.mockResolvedValue([]);
    const { result } = renderHook(() => useInsights());
    expect(result.current.loading).toBe(true);
  });

  it('loads insights and clears loading', async () => {
    api.get.mockResolvedValue(mockInsights);

    const { result } = renderHook(() => useInsights(5));
    await act(async () => {});

    expect(api.get).toHaveBeenCalledWith('/insights?limit=5');
    expect(result.current.insights).toEqual(mockInsights);
    expect(result.current.loading).toBe(false);
  });

  it('defaults to empty array on error', async () => {
    loadWithCache.mockImplementation(async (_key, _fetcher, _onData, onError) => {
      if (onError) onError(new Error('fail'));
    });

    const { result } = renderHook(() => useInsights());
    await act(async () => {});

    expect(result.current.insights).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('markSeen posts seen IDs and updates local state', async () => {
    api.get.mockResolvedValue(mockInsights);

    const { result } = renderHook(() => useInsights());
    await act(async () => {});
    await act(async () => { await result.current.markSeen(['i-1']); });

    expect(api.post).toHaveBeenCalledWith('/insights/seen', { ids: ['i-1'] });
    const updated = result.current.insights.find(i => i.id === 'i-1');
    expect(updated.state.status).toBe('seen');
  });

  it('dismiss removes insight from list', async () => {
    api.get.mockResolvedValue(mockInsights);

    const { result } = renderHook(() => useInsights());
    await act(async () => {});
    await act(async () => { await result.current.dismiss('i-1'); });

    expect(api.post).toHaveBeenCalledWith('/insights/i-1/dismiss', {});
    expect(result.current.insights.find(i => i.id === 'i-1')).toBeUndefined();
    expect(result.current.insights).toHaveLength(1);
  });

  it('logEvents posts events to API', async () => {
    api.get.mockResolvedValue([]);

    const { result } = renderHook(() => useInsights());
    await act(async () => {});
    await act(async () => {
      await result.current.logEvents([{ insight_id: 'i-1', event_type: 'clicked' }]);
    });

    expect(api.post).toHaveBeenCalledWith('/insights/events', {
      events: [{ insight_id: 'i-1', event_type: 'clicked', metadata: undefined }],
    });
  });

  it('logEvents ignores events with missing fields', async () => {
    api.get.mockResolvedValue([]);

    const { result } = renderHook(() => useInsights());
    await act(async () => {});
    await act(async () => {
      await result.current.logEvents([{ insight_id: '', event_type: 'clicked' }]);
    });

    expect(api.post).not.toHaveBeenCalledWith('/insights/events', expect.anything());
  });
});
