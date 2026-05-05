import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadCurrentUserCache, saveCurrentUserCache } from '../services/currentUserCache';

export function useCurrentUser() {
  const [user, setUser] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/users/me');
      setUser(me || null);
      await saveCurrentUserCache(me);
      return me || null;
    } catch (err) {
      throw err;
    }
  }, []);

  useEffect(() => {
    let active = true;

    loadCurrentUserCache()
      .then((cachedUser) => {
        if (active && cachedUser) setUser(cachedUser);
      })
      .catch(() => {});

    api.get('/users/me')
      .then(async (me) => {
        if (!active) return;
        setUser(me || null);
        await saveCurrentUserCache(me);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  return { user, userId: user?.id || null, refresh };
}
