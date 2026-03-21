import { useState, useEffect } from 'react';
import { api } from '../services/api';

export function useCurrentUser() {
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    api.get('/users/me')
      .then(me => setUserId(me?.id || null))
      .catch(() => {});
  }, []);

  return userId;
}
