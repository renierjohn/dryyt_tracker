import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from './api';

export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  role_id: number;
  role_name: string;
  permissions: string[];
  avatar_key: string | null;
  parent_id: number | null;
  contact_number: string | null;
}

export interface Masquerade {
  by_display_name: string;
}

export function useCurrentUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [masquerade, setMasquerade] = useState<Masquerade | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const body = await apiFetch<{ user: AuthUser; masquerade: Masquerade | null }>('/auth/me', {
        // API GETs are cacheable for 60s (worker/middleware/cache.ts); the session
        // check must always revalidate or login/logout/masquerade look stale.
        cache: 'no-cache',
      });
      setUser(body.user);
      setMasquerade(body.masquerade);
    } catch (err) {
      // Any failure here (401 unauthenticated, or a network blip/unexpected error)
      // should behave like "not logged in" rather than crash — this call is fired
      // with `void refresh()` from an effect, so a thrown error becomes an
      // unhandled promise rejection instead of a catchable error.
      if (!(err instanceof ApiError && err.status === 401)) {
        console.error('Failed to load current user', err);
      }
      setUser(null);
      setMasquerade(null);
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

  return { user, masquerade, loading, refresh };
}
