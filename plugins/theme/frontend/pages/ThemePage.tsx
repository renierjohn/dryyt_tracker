import { useEffect, useState } from 'react';
import { apiFetch, ApiError, useSession, AppShell } from '../../../sdk';
import { FLAVORS, FLAVOR_LABELS, type Flavor } from '../../manifest';

// Light-mode accents from theme.scss / _variables.scss — static here because the
// live --accent only reflects the flavor currently applied to <html>.
const SWATCHES: Record<Flavor, string> = {
  default: '#aa3bff',
  ocean: '#0ea5e9',
  sunset: '#f97316',
  forest: '#16a34a',
  midnight: '#6366f1',
};

function applyFlavor(flavor: Flavor) {
  document.documentElement.dataset.theme = flavor;
}

export default function ThemePage() {
  const { user, refresh } = useSession();
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
    applyFlavor(next);
    try {
      await apiFetch('/plugins/theme/me', { method: 'PUT', body: JSON.stringify({ flavor: next }) });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <AppShell active="dashboard" user={user} refresh={refresh} contentClassName="m3-page">
      <h1 className="m3-headline">Theme</h1>
      <section>
        {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
        {saved && <p className="m3-banner" role="status">Saved.</p>}
        <div className="m3-card">
          {flavor === null ? (
            <p className="m3-supporting">Loading…</p>
          ) : editable ? (
            <>
              <h2 className="m3-card__title">Flavor</h2>
              <p className="m3-supporting">Applies to your account and every user you've created.</p>
              <fieldset className="m3-choice-grid">
                <legend className="visually-hidden">Flavor</legend>
                {FLAVORS.map((f) => (
                  <label key={f} className="m3-choice">
                    <input
                      type="radio"
                      name="flavor"
                      value={f}
                      checked={flavor === f}
                      onChange={() => handleChange(f)}
                    />
                    <span className="m3-swatch" style={{ background: SWATCHES[f] }} aria-hidden="true" />
                    {FLAVOR_LABELS[f]}
                  </label>
                ))}
              </fieldset>
            </>
          ) : (
            <>
              <h2 className="m3-card__title">Flavor</h2>
              <p className="m3-supporting">
                Your theme (<strong>{FLAVOR_LABELS[flavor]}</strong>) is set by your account owner.
              </p>
            </>
          )}
        </div>
      </section>
    </AppShell>
  );
}
