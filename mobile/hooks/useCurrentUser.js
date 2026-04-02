import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';

export function useCurrentUser() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    loadWithCache(
      'cache:current-user',
      () => api.get('/users/me'),
      (me) => setUser(me || null),
    );
  }, []);

  return { user, userId: user?.id || null };
}
