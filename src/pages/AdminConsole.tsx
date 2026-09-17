import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import AlertEditor, { type AlertFormValues } from '../components/AlertEditor';
import type { AuthUser } from '../lib/useCurrentUser';
import ProfileSettings from './ProfileSettings';
import '../assets/sass/admin-console.scss';

interface AdminUser {
  id: number;
  email: string;
  display_name: string;
  avatar_key: string | null;
  role_id: number;
  role_name: string;
  is_active: number;
  created_at: string;
}

interface Role {
  id: number;
  name: string;
}

export default function AdminConsole({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [alertTargetId, setAlertTargetId] = useState<number | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

  async function loadUsers() {
    try {
      const body = await apiFetch<{ users: AdminUser[] }>('/admin/users');
      setUsers(body.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  async function loadRoles() {
    try {
      const body = await apiFetch<{ roles: Role[] }>('/admin/roles');
      setRoles(body.roles);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  useEffect(() => {
    // loadUsers is async and only calls setUsers/setError after its internal `await
    // apiFetch(...)` resolves — that's the same "fetch in an effect, setState in a .then"
    // shape React's docs recommend, just factored into a named helper (shared with the
    // create-user form's onCreated callback) instead of an inline promise chain. It does
    // not set state synchronously during the effect's own execution, so this is a false
    // positive for this specific case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUsers();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRoles();
  }, []);

  async function handleDeactivate(id: number) {
    try {
      await apiFetch(`/admin/users/${id}/deactivate`, { method: 'POST' });
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  async function handleReactivate(id: number) {
    try {
      await apiFetch(`/admin/users/${id}/reactivate`, { method: 'POST' });
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  async function handleMasquerade(id: number) {
    try {
      await apiFetch(`/admin/users/${id}/masquerade`, { method: 'POST' });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  async function handleUpdateUser(values: { email: string; display_name: string; role_id?: number }) {
    if (editingUser === null) return;
    try {
      await apiFetch(`/admin/users/${editingUser.id}`, { method: 'PUT', body: JSON.stringify(values) });
      setEditingUser(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  async function handleInjectAlert(values: AlertFormValues) {
    if (alertTargetId === null) return;
    try {
      await apiFetch(`/admin/users/${alertTargetId}/alerts`, { method: 'POST', body: JSON.stringify(values) });
      setAlertTargetId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <div className="admin-console">
      <Link className="back-link" to="/">← Home</Link>
      <ProfileSettings user={user} refresh={refresh} />
      <h1>Admin console</h1>
      {error && <p className="admin-console__error" role="alert">{error}</p>}
      <CreateUserForm roles={roles} onCreated={loadUsers} />
      <table className="admin-console__table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Display name</th>
            <th>Role</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.display_name}</td>
              <td>{u.role_name}</td>
              <td>
                <span className={`admin-console__status admin-console__status--${u.is_active ? 'active' : 'inactive'}`}>
                  {u.is_active ? 'yes' : 'no'}
                </span>
              </td>
              <td className="admin-console__actions">
                {u.is_active ? (
                  <button onClick={() => handleDeactivate(u.id)} disabled={u.id === 1}>
                    Deactivate
                  </button>
                ) : (
                  <button onClick={() => handleReactivate(u.id)}>Reactivate</button>
                )}
                <button onClick={() => setAlertTargetId(u.id)}>Inject alert</button>
                <button onClick={() => setEditingUser(u)}>Edit</button>
                <button onClick={() => handleMasquerade(u.id)} disabled={u.id === 1 || u.id === user.id || !u.is_active}>
                  Masquerade
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {alertTargetId !== null && (
        <div className="admin-console__panel">
          <h2>Inject alert for user {alertTargetId}</h2>
          <AlertEditor submitLabel="Send alert" onSubmit={handleInjectAlert} />
          <button onClick={() => setAlertTargetId(null)}>Cancel</button>
        </div>
      )}
      {editingUser !== null && (
        <div className="admin-console__panel">
          <h2>Edit user {editingUser.email}</h2>
          <EditUserForm user={editingUser} roles={roles} onSubmit={handleUpdateUser} onCancel={() => setEditingUser(null)} />
        </div>
      )}
    </div>
  );
}

function CreateUserForm({ roles, onCreated }: { roles: Role[]; onCreated: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleId, setRoleId] = useState(2);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: displayName, role_id: roleId }),
      });
      setEmail('');
      setPassword('');
      setDisplayName('');
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <form className="admin-console__form" onSubmit={handleSubmit}>
      <h2>Create user</h2>
      {error && <p role="alert">{error}</p>}
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </label>
      <label>
        Display name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </label>
      <label>
        Role
        <select value={roleId} onChange={(e) => setRoleId(Number(e.target.value))} required>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>
      <button type="submit">Create</button>
    </form>
  );
}

function EditUserForm({
  user,
  roles,
  onSubmit,
  onCancel,
}: {
  user: AdminUser;
  roles: Role[];
  onSubmit: (values: { email: string; display_name: string; role_id?: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState(user.email);
  const [displayName, setDisplayName] = useState(user.display_name);
  const [roleId, setRoleId] = useState(user.role_id);
  const [error, setError] = useState<string | null>(null);
  const isSuperadmin = user.id === 1;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      // The superadmin's role can never change server-side (PUT rejects it with
      // cannot_change_superadmin_role) — omit role_id entirely rather than resend
      // the unchanged value, which would still trip that check.
      await onSubmit({ email, display_name: displayName, ...(isSuperadmin ? {} : { role_id: roleId }) });
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <form className="admin-console__form" onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Display name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </label>
      <label>
        Role
        <select
          value={roleId}
          onChange={(e) => setRoleId(Number(e.target.value))}
          required
          disabled={isSuperadmin}
        >
          {isSuperadmin && <option value={user.role_id}>{user.role_name}</option>}
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}
