import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { CONTACT_ERROR, isInvalidContact } from '../lib/contact';
import Dialog from './Dialog';
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

interface CustomerTransaction {
  id: number;
  control_number: string | null;
  code: string;
  weight_kg: number | null;
  status: string;
  created_at: string;
  done_at: string | null;
}

// Mirrors the workflow plugin's status labels.
const STATUS_LABELS: Record<string, string> = {
  hold: 'On hold',
  in_progress: 'In progress',
  done: 'Done',
  ready_to_pickup: 'Ready for pickup',
  end: 'End',
};

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value.replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export default function OwnerUsers() {
  const [users, setUsers] = useState<ChildUser[]>([]);
  const [viewing, setViewing] = useState<ChildUser | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  async function loadUsers(target = page) {
    try {
      const body = await apiFetch<{ users: ChildUser[]; total: number; page_size: number }>(
        `/owner/users?page=${target}`,
      );
      // A page left empty (e.g. after the last row on it was removed) steps
      // back to the last page that has rows.
      const lastPage = Math.max(1, Math.ceil(body.total / body.page_size));
      if (target > lastPage) return loadUsers(lastPage);
      setPage(target);
      setUsers(body.users);
      setTotal(body.total);
      setPageSize(body.page_size);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    void loadUsers(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <details className="dashboard__section dashboard__collapsible">
        <summary>Create user</summary>
        <CreateChildUserForm onCreated={() => loadUsers()} />
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
                      {u.contact_number ? (
                        <button type="button" className="dashboard__link" onClick={() => setViewing(u)}>
                          View
                        </button>
                      ) : (
                        '—'
                      )}
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
        {total > 0 && (
          <nav className="dashboard__pagination" aria-label="Customers pages">
            <span>
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            </span>
            {pageCount > 1 && (
              <span className="dashboard__pagination-controls">
                <button
                  type="button"
                  className="dashboard__button"
                  onClick={() => void loadUsers(page - 1)}
                  disabled={page === 1}
                >
                  ‹ Prev
                </button>
                <span className="dashboard__pagination-page" aria-current="page">
                  Page {page} of {pageCount}
                </span>
                <button
                  type="button"
                  className="dashboard__button"
                  onClick={() => void loadUsers(page + 1)}
                  disabled={page === pageCount}
                >
                  Next ›
                </button>
              </span>
            )}
          </nav>
        )}
      </section>
      {viewing && <TransactionsDialog user={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

// The customer's transactions with this owner, looked up by contact number.
function TransactionsDialog({ user, onClose }: { user: ChildUser; onClose: () => void }) {
  const [transactions, setTransactions] = useState<CustomerTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Rounded to 2 decimals to drop float noise (0.1 + 0.2).
  const totalWeight = Math.round((transactions ?? []).reduce((sum, t) => sum + (t.weight_kg ?? 0), 0) * 100) / 100;

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ contact_number: user.contact_number ?? '' });
    apiFetch<{ customers: { id: number; transactions: CustomerTransaction[] }[] }>(`/plugins/workflow/customers?${qs}`)
      .then((body) => {
        if (!cancelled) setTransactions(body.customers.find((c) => c.id === user.id)?.transactions ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <Dialog title={`Transactions — ${user.display_name}`} onClose={onClose}>
      {error ? (
        <p role="alert">{error}</p>
      ) : transactions === null ? (
        <p>Loading…</p>
      ) : transactions.length === 0 ? (
        <p>No transactions yet.</p>
      ) : (
        <div className="dashboard__table-wrap">
          <table className="dashboard__table">
            <thead>
              <tr>
                <th>Control #</th>
                <th>Code</th>
                <th>Weight (kg)</th>
                <th>Status</th>
                <th>Start</th>
                <th>End</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td>{t.control_number ?? '—'}</td>
                  <td>
                    <code>{t.code}</code>
                  </td>
                  <td>{t.weight_kg ?? '—'}</td>
                  <td>{STATUS_LABELS[t.status] ?? t.status}</td>
                  <td>{formatDateTime(t.created_at)}</td>
                  <td>{formatDateTime(t.done_at)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={2}>Total weight</th>
                <th className="dashboard__total">{totalWeight}</th>
                <th colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Dialog>
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
