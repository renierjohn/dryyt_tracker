import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import AlertEditor, { type AlertFormValues } from '../components/AlertEditor';

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

export default function AdminConsole() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [alertTargetId, setAlertTargetId] = useState<number | null>(null);

  async function loadUsers() {
    try {
      const body = await apiFetch<{ users: AdminUser[] }>('/admin/users');
      setUsers(body.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  useEffect(() => {
    void loadUsers();
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
    <div>
      <h1>Admin console</h1>
      {error && <p role="alert">{error}</p>}
      <CreateUserForm onCreated={loadUsers} />
      <table>
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
              <td>{u.is_active ? 'yes' : 'no'}</td>
              <td>
                {u.is_active ? (
                  <button onClick={() => handleDeactivate(u.id)} disabled={u.id === 1}>
                    Deactivate
                  </button>
                ) : (
                  <button onClick={() => handleReactivate(u.id)}>Reactivate</button>
                )}
                <button onClick={() => setAlertTargetId(u.id)}>Inject alert</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {alertTargetId !== null && (
        <div>
          <h2>Inject alert for user {alertTargetId}</h2>
          <AlertEditor submitLabel="Send alert" onSubmit={handleInjectAlert} />
          <button onClick={() => setAlertTargetId(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => Promise<void> }) {
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
    <form onSubmit={handleSubmit}>
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
        Role ID
        <input type="number" value={roleId} onChange={(e) => setRoleId(Number(e.target.value))} required />
      </label>
      <button type="submit">Create</button>
    </form>
  );
}
