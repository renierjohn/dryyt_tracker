import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import type { AuthUser, Masquerade } from '../lib/useCurrentUser';
import '../assets/sass/masquerade-banner.scss';

export default function MasqueradeBanner({
  user,
  masquerade,
  refresh,
}: {
  user: AuthUser;
  masquerade: Masquerade;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleReturn() {
    setError(null);
    try {
      await apiFetch('/auth/return-to-admin', { method: 'POST' });
      await refresh();
      navigate('/admin');
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <div className="masquerade-banner">
      <span>
        {masquerade.by_display_name} is viewing as <strong>{user.display_name}</strong>
      </span>
      {error && <span role="alert">{error}</span>}
      <button onClick={handleReturn}>Return to admin</button>
    </div>
  );
}
