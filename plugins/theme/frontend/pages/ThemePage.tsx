import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError, useCurrentUser, hasPermission } from '../../../sdk';
import { FLAVORS, FLAVOR_LABELS, type Flavor } from '../../manifest';

export default function ThemePage() {
  const { user } = useCurrentUser();
  const [flavor, setFlavor] = useState<Flavor | null>(null);
  const [editable, setEditable] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const body = await apiFetch<{ flavor: Flavor; editable: boolean }>('/plugins/theme/me');
      setFlavor(body.flavor);
      setEditable(body.editable);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  async function handleChange(next: Flavor) {
    setFlavor(next);
    setSaved(false);
    setError(null);
    document.documentElement.dataset.theme = next;
    try {
      await apiFetch('/plugins/theme/me', { method: 'PUT', body: JSON.stringify({ flavor: next }) });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '64px auto', padding: '0 20px', textAlign: 'center' }}>
      <h1>Theme</h1>
      {error && <p role="alert">{error}</p>}
      {flavor === null ? (
        <p>Loading…</p>
      ) : editable ? (
        <>
          <p>Pick a flavor — it applies to your account and every user you've created.</p>
          <select value={flavor} onChange={(e) => handleChange(e.target.value as Flavor)}>
            {FLAVORS.map((f) => (
              <option key={f} value={f}>{FLAVOR_LABELS[f]}</option>
            ))}
          </select>
          {saved && <p>Saved.</p>}
        </>
      ) : (
        <p>
          Your theme (<strong>{FLAVOR_LABELS[flavor]}</strong>) is set by your account owner.
        </p>
      )}

      <nav className="tab-bar">
        <Link className="tab" to="/dashboard">Dashboard</Link>
        {user && hasPermission(user, 'manage_users') && (
          <Link className="tab" to="/plugins/workflow">Track</Link>
        )}
      </nav>
    </div>
  );
}
