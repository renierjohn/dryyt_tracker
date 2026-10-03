import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import AlertEditor, { type AlertFormValues } from '../components/AlertEditor';
import AppShell from '../components/AppShell';
import type { AuthUser } from '../lib/useCurrentUser';
import ProfileSettings from './ProfileSettings';
import '../assets/sass/dashboard.scss';
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

type AdminTab = 'users' | 'profile';
type StatusFilter = 'all' | 'active' | 'inactive';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: 'Enter a valid email address.',
  email_taken: 'That email is already in use.',
  weak_password: 'Password must be at least 8 characters.',
  missing_display_name: 'Display name is required.',
  cannot_assign_superadmin_role: 'The superadmin role can’t be assigned.',
  cannot_change_superadmin_role: 'The superadmin’s role can’t be changed.',
  user_deactivated: 'That user is deactivated.',
  missing_body: 'Write a message first.',
};

function errorMessage(err: unknown): string {
  const code = err instanceof ApiError ? err.code : 'unknown_error';
  return ERROR_MESSAGES[code] ?? code;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

// SQLite datetime('now') values are UTC without a zone.
function formatDate(value: string) {
  return new Date(value.replace(' ', 'T') + 'Z').toLocaleDateString([], { dateStyle: 'medium' });
}

export default function AdminConsole({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  const [tab, setTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [alertTarget, setAlertTarget] = useState<AdminUser | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);

  async function loadUsers() {
    try {
      const body = await apiFetch<{ users: AdminUser[] }>('/admin/users');
      setUsers(body.users);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function loadRoles() {
    try {
      const body = await apiFetch<{ roles: Role[] }>('/admin/roles');
      setRoles(body.roles);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    // Both loaders only set state after their awaited fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUsers();
    void loadRoles();
  }, []);

  // Runs a row action, then reloads the list and reports the outcome.
  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await loadUsers();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function handleDeactivate(u: AdminUser) {
    if (!window.confirm(`Deactivate ${u.display_name}? They will be signed out and can’t log in.`)) return;
    void run(() => apiFetch(`/admin/users/${u.id}/deactivate`, { method: 'POST' }), `${u.display_name} deactivated.`);
  }

  function handleReactivate(u: AdminUser) {
    void run(() => apiFetch(`/admin/users/${u.id}/reactivate`, { method: 'POST' }), `${u.display_name} reactivated.`);
  }

  async function handleMasquerade(u: AdminUser) {
    setError(null);
    try {
      await apiFetch(`/admin/users/${u.id}/masquerade`, { method: 'POST' });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const roleNames = useMemo(() => [...new Set(users.map((u) => u.role_name))].sort(), [users]);
  const stats = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.is_active).length,
      owners: users.filter((u) => u.role_name === 'owner').length,
      customers: users.filter((u) => u.role_name === 'user').length,
    }),
    [users],
  );
  const visibleUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter(
      (u) =>
        (roleFilter === 'all' || u.role_name === roleFilter) &&
        (statusFilter === 'all' || (statusFilter === 'active') === Boolean(u.is_active)) &&
        (!q || u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
    );
  }, [users, query, roleFilter, statusFilter]);

  return (
    <AppShell active="dashboard" user={user} refresh={refresh} contentClassName="dashboard dashboard__content admin">
      <h1 className="dashboard__headline">Admin console</h1>

      <div className="dashboard__main">
        <div className="dashboard__tabs" role="tablist">
          {(['users', 'profile'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`dashboard__tab${tab === key ? ' dashboard__tab--active' : ''}`}
              onClick={() => setTab(key)}
            >
              {key === 'users' ? 'Users' : 'Profile'}
            </button>
          ))}
        </div>

        {tab === 'profile' && <ProfileSettings user={user} refresh={refresh} />}

        {tab === 'users' && (
          <>
            {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
            {notice && <p className="m3-banner" role="status">{notice}</p>}

            <ul className="admin__stats" aria-label="User totals">
              <Stat label="Users" value={stats.total} />
              <Stat label="Active" value={stats.active} />
              <Stat label="Owners" value={stats.owners} />
              <Stat label="Customers" value={stats.customers} />
            </ul>

            <details className="m3-card m3-collapsible">
              <summary className="m3-card__title">Create user</summary>
              <CreateUserForm
                roles={roles}
                onCreated={async (name) => {
                  setNotice(`${name} created.`);
                  await loadUsers();
                }}
              />
            </details>

            <div className="m3-card m3-card--flush">
              <div className="admin__toolbar">
                <h2 className="m3-card__title">All users</h2>
                <input
                  className="admin__search"
                  type="search"
                  placeholder="Search name or email"
                  aria-label="Search users"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  className="m3-select m3-select--dense"
                  aria-label="Filter by role"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                >
                  <option value="all">All roles</option>
                  {roleNames.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <select
                  className="m3-select m3-select--dense"
                  aria-label="Filter by status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                >
                  <option value="all">Any status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              {visibleUsers.length === 0 ? (
                <p className="m3-supporting admin__empty">No users match.</p>
              ) : (
                <div className="m3-table-wrap">
                  <table className="m3-table admin__table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Joined</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleUsers.map((u) => (
                        <tr key={u.id} className={u.is_active ? undefined : 'admin__row--inactive'}>
                          <td>
                            <div className="admin__user">
                              {u.avatar_key ? (
                                <img className="admin__avatar" src={`/api/avatars/${u.avatar_key}`} alt="" loading="lazy" />
                              ) : (
                                <span className="admin__avatar" aria-hidden="true">{initials(u.display_name)}</span>
                              )}
                              <span className="admin__user-text">
                                <span className="admin__user-name">
                                  {u.display_name}
                                  {u.id === user.id && <span className="admin__you">you</span>}
                                </span>
                                <span className="admin__user-email">{u.email}</span>
                              </span>
                            </div>
                          </td>
                          <td><span className={`admin__chip admin__chip--${u.role_name}`}>{u.role_name}</span></td>
                          <td>
                            <span className={`admin__status admin__status--${u.is_active ? 'active' : 'inactive'}`}>
                              {u.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="m3-table__nowrap">{formatDate(u.created_at)}</td>
                          <td>
                            <div className="admin__actions">
                              <button type="button" className="admin__action" onClick={() => setEditingUser(u)}>
                                Edit
                              </button>
                              <button type="button" className="admin__action" onClick={() => setAlertTarget(u)}>
                                Alert
                              </button>
                              <button
                                type="button"
                                className="admin__action"
                                onClick={() => handleMasquerade(u)}
                                disabled={u.id === 1 || u.id === user.id || !u.is_active}
                              >
                                Masquerade
                              </button>
                              {u.is_active ? (
                                <button
                                  type="button"
                                  className="admin__action admin__action--danger"
                                  onClick={() => handleDeactivate(u)}
                                  disabled={u.id === 1}
                                >
                                  Deactivate
                                </button>
                              ) : (
                                <button type="button" className="admin__action" onClick={() => handleReactivate(u)}>
                                  Reactivate
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {editingUser && (
        <Dialog title={`Edit ${editingUser.display_name}`} onClose={() => setEditingUser(null)}>
          <EditUserForm
            user={editingUser}
            roles={roles}
            onCancel={() => setEditingUser(null)}
            onSubmit={async (values) => {
              await apiFetch(`/admin/users/${editingUser.id}`, { method: 'PUT', body: JSON.stringify(values) });
              setEditingUser(null);
              setNotice(`${values.display_name} updated.`);
              await loadUsers();
            }}
          />
        </Dialog>
      )}

      {alertTarget && (
        <Dialog title={`Send alert to ${alertTarget.display_name}`} onClose={() => setAlertTarget(null)}>
          <AlertEditor
            submitLabel="Send alert"
            onSubmit={async (values: AlertFormValues) => {
              const target = alertTarget;
              setAlertTarget(null);
              await run(
                () => apiFetch(`/admin/users/${target.id}/alerts`, { method: 'POST', body: JSON.stringify(values) }),
                `Alert sent to ${target.display_name}.`,
              );
            }}
          />
        </Dialog>
      )}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <li className="admin__stat">
      <span className="admin__stat-value">{value}</span>
      <span className="admin__stat-label">{label}</span>
    </li>
  );
}

// Native modal <dialog>: focus trapping, Esc and the backdrop come for free.
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="admin__dialog"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <header className="admin__dialog-head">
        <h2>{title}</h2>
        <button type="button" className="admin__dialog-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="admin__dialog-body">{children}</div>
    </dialog>
  );
}

function CreateUserForm({ roles, onCreated }: { roles: Role[]; onCreated: (name: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleId, setRoleId] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: displayName, role_id: roleId }),
      });
      setEmail('');
      setPassword('');
      setDisplayName('');
      await onCreated(displayName);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="m3-form" onSubmit={handleSubmit}>
      {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Display name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </label>
      <label>
        Role
        <select value={roleId} onChange={(e) => setRoleId(Number(e.target.value))} required>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="m3-button" disabled={saving}>
        {saving ? 'Creating…' : 'Create user'}
      </button>
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
  const [saving, setSaving] = useState(false);
  const isSuperadmin = user.id === 1;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      // The superadmin's role can never change server-side (PUT rejects it with
      // cannot_change_superadmin_role) — omit role_id entirely rather than resend
      // the unchanged value, which would still trip that check.
      await onSubmit({ email, display_name: displayName, ...(isSuperadmin ? {} : { role_id: roleId }) });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <form className="m3-form" onSubmit={handleSubmit}>
      {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
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
        <select value={roleId} onChange={(e) => setRoleId(Number(e.target.value))} required disabled={isSuperadmin}>
          {isSuperadmin && <option value={user.role_id}>{user.role_name}</option>}
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>
      <div className="admin__dialog-actions">
        <button type="button" className="m3-button m3-button--tonal" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="m3-button" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
