import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthUser } from '../lib/useCurrentUser';
import { apiFetch, ApiError } from '../lib/api';
import { canSendAlerts, isOwner } from '../lib/permissions';
import { Icon } from '../components/AppShell';
import AlertEditor, { type AlertFormValues } from '../components/AlertEditor';
import Dialog from '../components/Dialog';
import RichText from '../components/RichText';
import ScrollHintWrap from '../components/ScrollHintWrap';
import '../assets/sass/dashboard.scss';
import {
  MAX_SOCIAL_LINKS,
  SOCIAL_LABELS,
  SOCIAL_PLATFORMS,
  type SocialLink,
  type SocialPlatform,
} from '../lib/socialLinks';

// D1's datetime('now') is UTC without a zone suffix.
const formatDateTime = (value: string) =>
  new Date(value.replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// A new row starts on the first platform not already listed.
const nextPlatform = (links: SocialLink[]) =>
  SOCIAL_PLATFORMS.find((p) => !links.some((l) => l.platform === p)) ?? 'website';

interface Alert {
  id: number;
  type: AlertFormValues['type'];
  visibility: AlertFormValues['visibility'];
  body_html: string;
  created_at: string;
}

export default function ProfileSettings({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  return (
    <>
      <AvatarSection user={user} refresh={refresh} />
      <ProfileForm user={user} refresh={refresh} />
      {isOwner(user) && <CoordinatesForm />}
      <PasswordForm />
    </>
  );
}

function AvatarSection({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await apiFetch('/profile/avatar', { method: 'POST', body: formData });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="dashboard__section">
      <h2>Avatar</h2>
      <div className="dashboard__avatar">
        {user.avatar_key && <img src={`/api/avatars/${user.avatar_key}`} alt="Your avatar" width={96} height={96} />}
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={uploading} />
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function ProfileForm({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [email, setEmail] = useState(user.email);
  const [contactNumber, setContactNumber] = useState(user.contact_number ?? '');
  // Each row gets a local id so React keeps inputs stable when one is removed.
  const [socialLinks, setSocialLinks] = useState<(SocialLink & { id: number })[]>([]);
  const nextLinkId = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function withIds(links: SocialLink[]) {
    return links.map((link) => ({ ...link, id: nextLinkId.current++ }));
  }

  useEffect(() => {
    apiFetch<{ social_links: SocialLink[] }>('/profile/social-links')
      .then((body) => setSocialLinks(withIds(body.social_links)))
      .catch((err) => setError(err instanceof ApiError ? err.code : 'unknown_error'));
  }, []);

  function updateLink(id: number, change: Partial<SocialLink>) {
    setSocialLinks((links) => links.map((link) => (link.id === id ? { ...link, ...change } : link)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const body = await apiFetch<{ social_links: SocialLink[] }>('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          display_name: displayName,
          email,
          contact_number: contactNumber,
          social_links: socialLinks.map(({ platform, url }) => ({ platform, url })),
        }),
      });
      // Normalized server-side (https:// added, blank rows dropped).
      setSocialLinks(withIds(body.social_links));
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <section className="dashboard__section">
      <h2>Profile</h2>
      <form className="dashboard__form" onSubmit={handleSubmit}>
        {error && <p role="alert">{error}</p>}
        {saved && <p className="dashboard__saved">Saved.</p>}
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Contact number
          <input
            type="tel"
            value={contactNumber}
            onChange={(e) => setContactNumber(e.target.value)}
            placeholder="e.g. +63 912 345 6789"
            autoComplete="tel"
          />
        </label>
        <fieldset className="dashboard__social">
          <legend>Social media links</legend>
          {socialLinks.map((link) => (
            <div key={link.id} className="dashboard__social-row">
              <select
                aria-label="Social media"
                value={link.platform}
                onChange={(e) => updateLink(link.id, { platform: e.target.value as SocialPlatform })}
              >
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>{SOCIAL_LABELS[p]}</option>
                ))}
              </select>
              <input
                type="url"
                aria-label={`${SOCIAL_LABELS[link.platform]} link`}
                value={link.url}
                onChange={(e) => updateLink(link.id, { url: e.target.value })}
                placeholder="https://"
              />
              <button
                type="button"
                className="dashboard__button"
                aria-label={`Remove ${SOCIAL_LABELS[link.platform]} link`}
                onClick={() => setSocialLinks((links) => links.filter((l) => l.id !== link.id))}
              >
                Remove
              </button>
            </div>
          ))}
          {socialLinks.length < MAX_SOCIAL_LINKS && (
            <button
              type="button"
              className="dashboard__button"
              onClick={() => setSocialLinks((links) => [...links, ...withIds([{ platform: nextPlatform(links), url: '' }])])}
            >
              + Add social media link
            </button>
          )}
        </fieldset>
        <button className="dashboard__button" type="submit">Save profile</button>
      </form>
    </section>
  );
}

// "lat, lng" as copied from Google Maps (right-click a spot → the first menu
// item). Returns null for anything else.
function parseCoordinates(value: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

function CoordinatesForm() {
  const [value, setValue] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    apiFetch<{ store: { lat: number | null; lng: number | null } }>('/owner/store')
      .then(({ store }) => {
        if (store.lat !== null && store.lng !== null) setValue(`${store.lat}, ${store.lng}`);
      })
      .catch((err) => setError(err instanceof ApiError ? err.code : 'unknown_error'))
      .finally(() => setLoaded(true));
  }, []);

  const parsed = parseCoordinates(value);
  const invalid = value.trim() !== '' && !parsed;

  // Fills the field from the device's GPS (the browser asks for permission);
  // the owner still saves it. Needs a secure context — https or localhost.
  function handleLocate() {
    setError(null);
    setSaved(false);
    if (!('geolocation' in navigator)) {
      setError('This device or browser can’t share its location.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setValue(`${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`);
        setLocating(false);
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. Allow it in your browser settings and try again.'
            : err.code === err.TIMEOUT
              ? 'Finding your location took too long. Try again.'
              : 'Couldn’t get your location. Try again.',
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (invalid) return;
    try {
      await apiFetch('/owner/coordinates', {
        method: 'PUT',
        body: JSON.stringify({ lat: parsed?.lat ?? null, lng: parsed?.lng ?? null }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <section className="dashboard__section">
      <h2>Your coordinates</h2>
      <form className="dashboard__form" onSubmit={handleSubmit}>
        {error && <p role="alert">{error}</p>}
        {saved && <p className="dashboard__saved">Coordinates saved.</p>}
        <label>
          Latitude, longitude
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            placeholder="14.599512, 120.984222"
            inputMode="decimal"
            aria-invalid={invalid}
            disabled={!loaded}
          />
        </label>
        <p className="dashboard__hint" aria-live="polite">
          {invalid
            ? 'Enter as “latitude, longitude”, e.g. 14.599512, 120.984222.'
            : parsed
              ? `Latitude: ${parsed.lat} · Longitude: ${parsed.lng}`
              : 'In Google Maps, right-click your store and click the coordinates to copy them. Leave empty to clear.'}
        </p>
        <div className="dashboard__form-actions">
          <button className="dashboard__button" type="submit" disabled={!loaded || invalid || locating}>
            Save coordinates
          </button>
          <button
            className="dashboard__button dashboard__button--tonal dashboard__button--with-icon"
            type="button"
            onClick={handleLocate}
            disabled={!loaded || locating}
          >
            <Icon name="pin" />
            {locating ? 'Locating…' : 'Locate Me'}
          </button>
        </div>
      </form>
    </section>
  );
}

function PasswordForm() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    try {
      await apiFetch('/profile/password', {
        method: 'PUT',
        body: JSON.stringify({ new_password: newPassword }),
      });
      setNewPassword('');
      setConfirmPassword('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <section className="dashboard__section">
      <h2>Change password</h2>
      <form className="dashboard__form" onSubmit={handleSubmit}>
        {error && <p role="alert">{error}</p>}
        {saved && <p className="dashboard__saved">Password changed.</p>}
        <label>
          New Password
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        <label>
          Confirm Password
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        <button className="dashboard__button" type="submit">Change password</button>
      </form>
    </section>
  );
}

export function AlertsPanel({ user }: { user: AuthUser }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [editing, setEditing] = useState<Alert | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadAlerts() {
    try {
      const body = await apiFetch<{ alerts: Alert[] }>('/alerts');
      // Dashboard-only alerts show as banners above the page (DashboardAlertBanners).
      setAlerts(body.alerts.filter((a) => a.visibility !== 'dashboard'));
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  useEffect(() => {
    // loadAlerts is async and only calls setAlerts/setError after its internal `await
    // apiFetch(...)` resolves — that's the same "fetch in an effect, setState in a .then"
    // shape React's docs recommend, just factored into a named helper (shared with the
    // create/update/delete handlers) instead of an inline promise chain. It does not set
    // state synchronously during the effect's own execution, so this is a false positive
    // for this specific case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAlerts();
  }, []);

  async function handleCreate(values: AlertFormValues) {
    try {
      await apiFetch('/alerts', { method: 'POST', body: JSON.stringify(values) });
      await loadAlerts();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  async function handleUpdate(id: number, values: AlertFormValues) {
    try {
      await apiFetch(`/alerts/${id}`, { method: 'PUT', body: JSON.stringify(values) });
      setEditing(null);
      await loadAlerts();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  async function handleDelete(id: number) {
    try {
      await apiFetch(`/alerts/${id}`, { method: 'DELETE' });
      await loadAlerts();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <section className="dashboard__section">
      <h2>Alerts</h2>
      {error && <p role="alert">{error}</p>}
      {canSendAlerts(user) && (
        <>
          <h3>New alert</h3>
          <AlertEditor visibilityOptions={['public']} submitLabel="Create alert" onSubmit={handleCreate} />
        </>
      )}
      <h3>Your alerts</h3>
      {alerts.length === 0 ? (
        <p className="dashboard__hint">No alerts.</p>
      ) : (
        <ScrollHintWrap className="dashboard__table-wrap">
          <table className="dashboard__table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Message</th>
                <th>Created</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id}>
                  <td>
                    <span className={`dashboard__alert-type dashboard__alert-type--${alert.type}`}>{alert.type}</span>
                  </td>
                  <td>
                    <RichText html={alert.body_html} lines={2} />
                  </td>
                  <td className="dashboard__nowrap">{formatDateTime(alert.created_at)}</td>
                  <td>
                    <div className="dashboard__alert-actions">
                      {canSendAlerts(user) && (
                        <button className="dashboard__button" onClick={() => setEditing(alert)}>Edit</button>
                      )}
                      <button className="dashboard__button" onClick={() => handleDelete(alert.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollHintWrap>
      )}
      {editing && (
        <Dialog title="Edit alert" onClose={() => setEditing(null)}>
          <AlertEditor
            visibilityOptions={['public']}
            initial={{ type: editing.type, visibility: editing.visibility, body_html: editing.body_html }}
            submitLabel="Save"
            onSubmit={(values) => handleUpdate(editing.id, values)}
          />
        </Dialog>
      )}
    </section>
  );
}
