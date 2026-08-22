import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from './api';

export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  role_id: number;
  role_name: string;
  permissions: string[];
}

export function useCurrentUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const body = await apiFetch<{ user: AuthUser }>('/auth/me');
      setUser(body.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      } else {
        throw err;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Idiomatic fetch-on-mount: refresh() sets loading/user state to reflect the
    // in-flight/completed session check, not a reactive cascade off other state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { user, loading, refresh };
}
