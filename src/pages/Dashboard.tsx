import { useEffect, useState, type FormEvent } from 'react';
import type { AuthUser } from '../lib/useCurrentUser';
import { apiFetch, ApiError } from '../lib/api';
import AlertEditor, { type AlertFormValues } from '../components/AlertEditor';

interface Alert {
  id: number;
  type: AlertFormValues['type'];
  visibility: AlertFormValues['visibility'];
  body_html: string;
}

export default function Dashboard({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  return (
    <div>
      <h1>Welcome, {user.display_name}</h1>
      <p>Role: {user.role_name}</p>
      <LogoutButton refresh={refresh} />
      <AvatarSection user={user} refresh={refresh} />
      <ProfileForm user={user} refresh={refresh} />
      <PasswordForm />
      <AlertsPanel />
    </div>
  );
}

function LogoutButton({ refresh }: { refresh: () => Promise<void> }) {
  async function handleLogout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout request failed', err);
    }
    await refresh();
  }
  return <button onClick={handleLogout}>Log out</button>;
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
    <section>
      <h2>Avatar</h2>
      {user.avatar_key && <img src={`/api/avatars/${user.avatar_key}`} alt="Your avatar" width={96} height={96} />}
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={uploading} />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function ProfileForm({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [email, setEmail] = useState(user.email);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await apiFetch('/profile', { method: 'PUT', body: JSON.stringify({ display_name: displayName, email }) });
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <section>
      <h2>Profile</h2>
      <form onSubmit={handleSubmit}>
        {error && <p role="alert">{error}</p>}
        {saved && <p>Saved.</p>}
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <button type="submit">Save profile</button>
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
    <section>
      <h2>Change password</h2>
      <form onSubmit={handleSubmit}>
        {error && <p role="alert">{error}</p>}
        {saved && <p>Password changed.</p>}
        <label>
          Current password
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </label>
        <label>
          New password
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        </label>
        <button type="submit">Change password</button>
      </form>
    </section>
  );
}

function AlertsPanel() {
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
    <section>
      <h2>Alerts</h2>
      {error && <p role="alert">{error}</p>}
      <h3>New alert</h3>
      <AlertEditor submitLabel="Create alert" onSubmit={handleCreate} />
      <h3>Your alerts</h3>
      <ul>
        {alerts.map((alert) => (
          <li key={alert.id}>
            {editingId === alert.id ? (
              <AlertEditor
                initial={{ type: alert.type, visibility: alert.visibility, body_html: alert.body_html }}
                submitLabel="Save"
                onSubmit={(values) => handleUpdate(alert.id, values)}
              />
            ) : (
              <>
                <span>[{alert.type}/{alert.visibility}]</span>
                <span dangerouslySetInnerHTML={{ __html: alert.body_html }} />
                <button onClick={() => setEditingId(alert.id)}>Edit</button>
                <button onClick={() => handleDelete(alert.id)}>Delete</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
