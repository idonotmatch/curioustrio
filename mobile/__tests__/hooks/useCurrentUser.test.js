import { renderHook, act } from '@testing-library/react-native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { mockCachePassthrough, mockCacheError } from './utils';

jest.mock('../../services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('../../services/cache', () => ({ loadWithCache: jest.fn() }));

const { api } = require('../../services/api');
const { loadWithCache } = require('../../services/cache');

beforeEach(() => {
  jest.clearAllMocks();
  mockCachePassthrough(loadWithCache);
});

describe('useCurrentUser', () => {
  it('starts with null user', () => {
    api.get.mockResolvedValue(null);
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.user).toBeNull();
    expect(result.current.userId).toBeNull();
  });

  it('loads user from /users/me', async () => {
    const mockUser = { id: 'user-1', name: 'Alice', email: 'alice@example.com' };
    api.get.mockResolvedValue(mockUser);

    const { result } = renderHook(() => useCurrentUser());
    await act(async () => {});

    expect(api.get).toHaveBeenCalledWith('/users/me');
    expect(result.current.user).toEqual(mockUser);
    expect(result.current.userId).toBe('user-1');
  });

  it('stays null when API returns null', async () => {
    api.get.mockResolvedValue(null);

    const { result } = renderHook(() => useCurrentUser());
    await act(async () => {});

    expect(result.current.user).toBeNull();
    expect(result.current.userId).toBeNull();
  });

  it('stays null on network error', async () => {
    mockCacheError(loadWithCache);

    const { result } = renderHook(() => useCurrentUser());
    await act(async () => {});

    expect(result.current.user).toBeNull();
  });
});
