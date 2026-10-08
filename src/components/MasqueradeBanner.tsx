import { useEffect, useRef, useState } from 'react';
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
  const ref = useRef<HTMLDivElement>(null);

  // Other sticky bars (dashboard alert banners) offset themselves by this.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty('--masquerade-banner-height', `${el.offsetHeight}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--masquerade-banner-height');
    };
  }, []);

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
    <div className="masquerade-banner" ref={ref}>
      <span>
        {masquerade.by_display_name} is viewing as <strong>{user.display_name}</strong>
      </span>
      {error && <span role="alert">{error}</span>}
      <button onClick={handleReturn}>Return to admin</button>
    </div>
  );
}
