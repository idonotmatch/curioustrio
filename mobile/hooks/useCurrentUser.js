import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';

export function useCurrentUser() {
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    loadWithCache(
      'cache:current-user',
      () => api.get('/users/me'),
      (me) => setUserId(me?.id || null),
    );
  }, []);

  return userId;
}
