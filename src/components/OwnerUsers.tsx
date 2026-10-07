import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { CONTACT_ERROR, isInvalidContact } from '../lib/contact';
import '../assets/sass/dashboard.scss';

function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'unknown_error';
  return err.code === 'invalid_contact_number' ? CONTACT_ERROR : err.code;
}

interface ChildUser {
  id: number;
  email: string;
  display_name: string;
  contact_number: string | null;
  is_active: number;
  created_at: string;
}

export default function OwnerUsers() {
  const [users, setUsers] = useState<ChildUser[]>([]);
  // Transaction codes per user id, from the workflow plugin. Best-effort: the
  // column just stays empty when the plugin isn't available.
  const [codes, setCodes] = useState<Map<number, string[]>>(new Map());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadUsers() {
    try {
      const body = await apiFetch<{ users: ChildUser[] }>('/owner/users');
      setUsers(body.users);
    } catch (err) {
      setError(errorMessage(err));
    }
    try {
      const body = await apiFetch<{ customers: { id: number; codes: string[] }[] }>('/plugins/workflow/customers');
      setCodes(new Map(body.customers.map((c) => [c.id, c.codes])));
    } catch {
      setCodes(new Map());
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUsers();
  }, []);

  return (
    <>
      <details className="dashboard__section dashboard__collapsible">
        <summary>Create user</summary>
        <CreateChildUserForm onCreated={loadUsers} />
      </details>
      <section className="dashboard__section">
        <h2>Your customers</h2>
        {error && <p role="alert">{error}</p>}
        <div className="dashboard__table-wrap">
          <table className="dashboard__table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Display name</th>
                <th>Contact</th>
                <th>Transactions</th>
                <th>Operations</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) =>
                editingId === u.id ? (
                  <EditUserRow
                    key={u.id}
                    user={u}
                    onCancel={() => setEditingId(null)}
                    onSaved={async () => {
                      setEditingId(null);
                      await loadUsers();
                    }}
                  />
                ) : (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.display_name}</td>
                    <td>{u.contact_number ?? ''}</td>
                    <td>
                      {(codes.get(u.id) ?? []).map((code, i) => (
                        <span key={code}>
                          {i > 0 && ', '}
                          <code>{code}</code>
                        </span>
                      ))}
                    </td>
                    <td>
                      <div className="dashboard__alert-actions">
                        <button type="button" className="dashboard__button" onClick={() => setEditingId(u.id)}>
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function EditUserRow({
  user,
  onCancel,
  onSaved,
}: {
  user: ChildUser;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [email, setEmail] = useState(user.email);
  const [displayName, setDisplayName] = useState(user.display_name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await apiFetch(`/owner/users/${user.id}`, {
        method: 'PUT',
        // Contact number is read-only here: it's how customers are matched
        // (and shared) across stores when transactions are registered.
        body: JSON.stringify({ email, display_name: displayName }),
      });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <tr>
      <td>
        <input type="email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </td>
      <td>
        <input aria-label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </td>
      <td>
        <input type="tel" aria-label="Contact" value={user.contact_number ?? ''} disabled />
      </td>
      <td>{error && <span role="alert">{error}</span>}</td>
      <td>
        <div className="dashboard__alert-actions">
          <button type="button" className="dashboard__button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="dashboard__button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

function CreateChildUserForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [error, setError] = useState<string | null>(null);

  const contactInvalid = isInvalidContact(contactNumber);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (contactInvalid) {
      setError(CONTACT_ERROR);
      return;
    }
    try {
      await apiFetch('/owner/users', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: displayName, contact_number: contactNumber }),
      });
      setEmail('');
      setPassword('');
      setDisplayName('');
      setContactNumber('');
      await onCreated();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="dashboard__form" onSubmit={handleSubmit}>
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
        Contact (optional)
        <input
          type="tel"
          aria-invalid={contactInvalid}
          value={contactNumber}
          onChange={(e) => setContactNumber(e.target.value)}
        />
        {contactInvalid && <span role="alert">{CONTACT_ERROR}</span>}
      </label>
      <button type="submit" className="dashboard__button">Create</button>
    </form>
  );
}
