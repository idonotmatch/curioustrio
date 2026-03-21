import { useState, useEffect } from 'react';
import { useAuth0 } from 'react-native-auth0';
import { api } from '../services/api';

export function useCurrentUser() {
  const { user } = useAuth0();
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    if (!user) return;
    api.post('/users/sync', {
      name: user.name || user.nickname || user.email,
      email: user.email,
    })
      .then(me => setUserId(me?.id || null))
      .catch(() => {});
  }, [user?.sub]);

  return userId;
}
