import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import '../assets/sass/dashboard.scss';

interface ChildUser {
  id: number;
  email: string;
  display_name: string;
  is_active: number;
  created_at: string;
}

export default function OwnerUsers() {
  const [users, setUsers] = useState<ChildUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadUsers() {
    try {
      const body = await apiFetch<{ users: ChildUser[] }>('/owner/users');
      setUsers(body.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUsers();
  }, []);

  return (
    <section className="dashboard__section">
      <h2>Your users</h2>
      {error && <p role="alert">{error}</p>}
      <CreateChildUserForm onCreated={loadUsers} />
      <table className="dashboard__table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Display name</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.display_name}</td>
              <td>{u.is_active ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CreateChildUserForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/owner/users', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: displayName }),
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
    <form className="dashboard__form" onSubmit={handleSubmit}>
      <h3>Create user</h3>
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
      <button type="submit" className="dashboard__button">Create</button>
    </form>
  );
}
