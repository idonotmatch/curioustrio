import { renderHook, act } from '@testing-library/react-native';
import { useHousehold } from '../../hooks/useHousehold';
import { mockCachePassthrough, mockCacheError } from './utils';

jest.mock('../../services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('../../services/cache', () => ({ loadWithCache: jest.fn() }));

const { api } = require('../../services/api');
const { loadWithCache } = require('../../services/cache');

beforeEach(() => {
  jest.clearAllMocks();
  mockCachePassthrough(loadWithCache);
});

const mockHouseholdData = {
  household: { id: 'h-1', name: 'Smith Family' },
  members: [
    { id: 'u-1', name: 'Alice' },
    { id: 'u-2', name: 'Bob' },
  ],
};

describe('useHousehold', () => {
  it('starts loading', () => {
    api.get.mockResolvedValue(mockHouseholdData);
    const { result } = renderHook(() => useHousehold());
    expect(result.current.loading).toBe(true);
  });

  it('loads household and members', async () => {
    api.get.mockResolvedValue(mockHouseholdData);

    const { result } = renderHook(() => useHousehold());
    await act(async () => {});

    expect(result.current.household).toEqual(mockHouseholdData.household);
    expect(result.current.members).toEqual(mockHouseholdData.members);
    expect(result.current.memberCount).toBe(2);
    expect(result.current.loading).toBe(false);
  });

  it('sets null household when user has none (404 path)', async () => {
    mockCacheError(loadWithCache);

    const { result } = renderHook(() => useHousehold());
    await act(async () => {});

    expect(result.current.household).toBeNull();
    expect(result.current.members).toEqual([]);
    expect(result.current.memberCount).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it('refresh triggers a re-fetch', async () => {
    api.get.mockResolvedValue(mockHouseholdData);

    const { result } = renderHook(() => useHousehold());
    await act(async () => {});
    await act(async () => { result.current.refresh(); });

    expect(loadWithCache).toHaveBeenCalledTimes(2);
  });
});
