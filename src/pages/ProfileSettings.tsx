import { useEffect, useState, type FormEvent } from 'react';
import type { AuthUser } from '../lib/useCurrentUser';
import { apiFetch, ApiError } from '../lib/api';
import { canSendAlerts, isCustomer } from '../lib/permissions';
import AlertEditor, { type AlertFormValues } from '../components/AlertEditor';
import '../assets/sass/dashboard.scss';

interface Alert {
  id: number;
  type: AlertFormValues['type'];
  visibility: AlertFormValues['visibility'];
  body_html: string;
}

export default function ProfileSettings({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  return (
    <>
      <AvatarSection user={user} refresh={refresh} />
      <ProfileForm user={user} refresh={refresh} />
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
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await apiFetch('/profile', {
        method: 'PUT',
        body: JSON.stringify({ display_name: displayName, email, contact_number: contactNumber }),
      });
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
        <button className="dashboard__button" type="submit">Save profile</button>
      </form>
    </section>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await apiFetch('/profile/password', {
        method: 'PUT',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
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
          Current password
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </label>
        <label>
          New password
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        </label>
        <button className="dashboard__button" type="submit">Change password</button>
      </form>
    </section>
  );
}

export function AlertsPanel({ user }: { user: AuthUser }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadAlerts() {
    try {
      const body = await apiFetch<{ alerts: Alert[] }>('/alerts');
      setAlerts(body.alerts);
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
      setEditingId(null);
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
      <ul className="dashboard__alert-list">
        {alerts.map((alert) => (
          // Customers see the alert formatted by type (as on the public page),
          // without the raw [type/visibility] tag.
          <li
            key={alert.id}
            className={isCustomer(user) ? `m3-alert m3-alert--${alert.type}` : 'dashboard__alert-item'}
          >
            {canSendAlerts(user) && editingId === alert.id ? (
              <AlertEditor
                visibilityOptions={['public']}
                initial={{ type: alert.type, visibility: alert.visibility, body_html: alert.body_html }}
                submitLabel="Save"
                onSubmit={(values) => handleUpdate(alert.id, values)}
              />
            ) : (
              <>
                {!isCustomer(user) && (
                  <span className="dashboard__alert-tag">[{alert.type}/{alert.visibility}]</span>
                )}
                <div dangerouslySetInnerHTML={{ __html: alert.body_html }} />
                <div className="dashboard__alert-actions">
                  {canSendAlerts(user) && (
                    <button className="dashboard__button" onClick={() => setEditingId(alert.id)}>Edit</button>
                  )}
                  <button className="dashboard__button" onClick={() => handleDelete(alert.id)}>Delete</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
