import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import AlertEditor, { type AlertFormValues } from '../components/AlertEditor';
import AppShell from '../components/AppShell';
import Dialog from '../components/Dialog';
import RichText from '../components/RichText';
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
  parent_id: number | null;
  is_active: number;
  created_at: string;
}

interface Role {
  id: number;
  name: string;
}

type AdminTab = 'users' | 'transactions' | 'sessions' | 'alerts' | 'profile';

const TAB_LABELS: Record<AdminTab, string> = {
  users: 'Users',
  transactions: 'Transactions',
  sessions: 'Sessions',
  alerts: 'Alerts',
  profile: 'Profile',
};

interface AdminSession {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  role_name: string;
  impersonator_name: string | null;
  created_at: string;
  expires_at: string;
}

interface AdminAlert {
  id: number;
  user_id: number;
  type: AlertFormValues['type'];
  visibility: AlertFormValues['visibility'];
  body_html: string;
  created_at: string;
  user_name: string;
  user_email: string;
  created_by_name: string | null;
}

interface AlertTarget {
  id: number;
  display_name: string;
  email: string;
}

interface SessionsBody {
  active: AdminSession[];
  expired: AdminSession[];
  active_total: number;
  expired_total: number;
}

interface AdminTransaction {
  id: number;
  code: string;
  status: string;
  customer_name: string;
  created_at: string;
  owner_name: string;
  user_id: number | null;
  user_name: string | null;
  user_email: string | null;
}

interface PurgeResult {
  cutoff: string;
  transactions: number;
}

interface AdminTransactionDetail extends AdminTransaction {
  customer_contact: string | null;
  description: string | null;
  updated_at: string;
  done_at: string | null;
  owner_email: string;
  weight_kg: number | null;
  control_number: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  hold: 'On hold',
  in_progress: 'In progress',
  done: 'Done',
  ready_to_pickup: 'Ready for pickup',
  end: 'End',
};
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
function formatDateTime(value: string) {
  return new Date(value.replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDate(value: string) {
  return new Date(value.replace(' ', 'T') + 'Z').toLocaleDateString([], { dateStyle: 'medium' });
}

export default function AdminConsole({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  const [tab, setTab] = useState<AdminTab>('users');
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [alertTarget, setAlertTarget] = useState<AdminUser | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AdminUser | null>(null);

  const debouncedQuery = useDebounced(query.trim(), 300);
  const userList = usePagedList<UsersResponse>('/admin/users', {
    q: debouncedQuery,
    role: roleFilter === 'all' ? '' : roleFilter,
    status: statusFilter === 'all' ? '' : statusFilter,
  });
  const users = userList.body?.users ?? [];
  const loadUsers = userList.reload;

  async function loadRoles() {
    try {
      const body = await apiFetch<{ roles: Role[] }>('/admin/roles');
      setRoles(body.roles);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    // Only sets state after its awaited fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRoles();
  }, []);

  // Runs a row action, then reloads the list and reports the outcome.
  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      loadUsers();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function handleDeactivate(u: AdminUser) {
    setDeactivateTarget(null);
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

  const stats = userList.body?.stats;
  const roleNames = stats?.role_names ?? [];

  return (
    <AppShell active="dashboard" user={user} refresh={refresh} contentClassName="dashboard dashboard__content admin">
      <h1 className="dashboard__headline">Admin console</h1>

      <div className="dashboard__main">
        <div className="dashboard__tabs" role="tablist">
          {(Object.keys(TAB_LABELS) as AdminTab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`dashboard__tab${tab === key ? ' dashboard__tab--active' : ''}`}
              onClick={() => setTab(key)}
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </div>

        {tab === 'profile' && <ProfileSettings user={user} refresh={refresh} />}
        {tab === 'transactions' && <TransactionsPanel />}
        {tab === 'sessions' && <SessionsPanel />}
        {tab === 'alerts' && <AllAlertsPanel />}

        {tab === 'users' && (
          <>
            {(error ?? userList.error) && (
              <p className="m3-banner m3-banner--error" role="alert">{error ?? userList.error}</p>
            )}
            {notice && <p className="m3-banner" role="status">{notice}</p>}

            <ul className="admin__stats" aria-label="User totals">
              <Stat label="Users" value={stats?.total} />
              <Stat label="Active" value={stats?.active} />
              <Stat label="Owners" value={stats?.owners} />
              <Stat label="Customers" value={stats?.customers} />
            </ul>

            <details className="m3-card m3-collapsible">
              <summary className="m3-card__title">Create user</summary>
              <CreateUserForm
                roles={roles}
                onCreated={async (name) => {
                  setNotice(`${name} created.`);
                  loadUsers();
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

              {!userList.body ? (
                <p className="m3-supporting admin__empty">Loading…</p>
              ) : users.length === 0 ? (
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
                      {users.map((u) => (
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
                                  {u.role_name === 'user' && u.parent_id === null && (
                                    <span className="admin__new" title="Not linked to any owner yet">new</span>
                                  )}
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
                                  onClick={() => setDeactivateTarget(u)}
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
              <Pagination {...userList} label="Users pages" />
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
              loadUsers();
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

      {deactivateTarget && (
        <Dialog title={`Deactivate ${deactivateTarget.display_name}?`} onClose={() => setDeactivateTarget(null)}>
          <p>They will be signed out and can’t log in until reactivated.</p>
          <div className="admin__dialog-actions">
            <button type="button" className="m3-button m3-button--tonal" onClick={() => setDeactivateTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="m3-button admin__dialog-danger"
              onClick={() => handleDeactivate(deactivateTarget)}
            >
              Deactivate
            </button>
          </div>
        </Dialog>
      )}
    </AppShell>
  );
}

const PURGE_PATH = '/plugins/workflow/admin/transactions/purge-old';

// All transactions across owners, from the workflow plugin's superadmin endpoint.
function TransactionsPanel() {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [purgeNotice, setPurgeNotice] = useState<string | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState<PurgeResult | null>(null);
  // How many transactions are past the 3-month mark (a dry-run count), shown
  // as a warning until they're deleted.
  const [stale, setStale] = useState<PurgeResult | null>(null);
  const [staleTick, setStaleTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<PurgeResult>(PURGE_PATH, {
      method: 'POST',
      body: JSON.stringify({ dry_run: true }),
    })
      .then((result) => {
        if (!cancelled) setStale(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [staleTick]);

  const debouncedQuery = useDebounced(query.trim(), 300);
  const list = usePagedList<{ transactions: AdminTransaction[] }>('/plugins/workflow/admin/transactions', {
    q: debouncedQuery,
    status: statusFilter === 'all' ? '' : statusFilter,
  });
  const transactions = list.body?.transactions ?? [];

  // Counts transactions created over 3 months ago, then asks to confirm
  // deleting them.
  async function handlePurge() {
    setPurgeError(null);
    setPurgeNotice(null);
    setPurging(true);
    try {
      const preview = await apiFetch<PurgeResult>(PURGE_PATH, { method: 'POST', body: JSON.stringify({ dry_run: true }) });
      if (preview.transactions === 0) {
        setPurgeNotice('No transactions are older than 3 months.');
        return;
      }
      setPurgeConfirm(preview);
    } catch (err) {
      setPurgeError(errorMessage(err));
    } finally {
      setPurging(false);
    }
  }

  async function confirmPurge() {
    setPurgeConfirm(null);
    setPurging(true);
    try {
      const done = await apiFetch<PurgeResult>(PURGE_PATH, { method: 'POST', body: JSON.stringify({}) });
      setPurgeNotice(`Deleted ${done.transactions} transaction(s).`);
      list.reload();
      setStaleTick((t) => t + 1);
    } catch (err) {
      setPurgeError(errorMessage(err));
    } finally {
      setPurging(false);
    }
  }

  return (
    <>
      {(list.error ?? purgeError) && (
        <p className="m3-banner m3-banner--error" role="alert">{list.error ?? purgeError}</p>
      )}
      {purgeNotice && <p className="m3-banner" role="status">{purgeNotice}</p>}
      {stale && stale.transactions > 0 && (
        <p className="m3-banner m3-banner--warning" role="alert">
          {stale.transactions} transaction(s) are more than 3 months old — created before{' '}
          {formatDateTime(stale.cutoff)}. Use “Delete” to remove them.
        </p>
      )}
      <div className="m3-card m3-card--flush">
        <div className="admin__toolbar">
          <h2 className="m3-card__title">All transactions</h2>
          <input
            className="admin__search"
            type="search"
            placeholder="Search code, owner or user"
            aria-label="Search transactions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="m3-select m3-select--dense"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Any status</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button
            type="button"
            className="admin__action admin__action--danger"
            onClick={handlePurge}
            disabled={purging}
            title="Delete transactions created more than 3 months ago"
          >
            {purging ? 'Deleting…' : 'Delete'}
          </button>
        </div>

        {!list.body ? (
          <p className="m3-supporting admin__empty">Loading…</p>
        ) : transactions.length === 0 ? (
          <p className="m3-supporting admin__empty">No transactions match.</p>
        ) : (
          <div className="m3-table-wrap">
            <table className="m3-table admin__table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Code</th>
                  <th>Owner</th>
                  <th>User</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button
                        type="button"
                        className="admin__action admin__order-link"
                        onClick={() => setOpenId(t.id)}
                        aria-label={`Show details for order ${t.id}`}
                      >
                        #{t.id}
                      </button>
                    </td>
                    <td><code>{t.code}</code></td>
                    <td>{t.owner_name}</td>
                    <td>
                      {t.user_id ? (
                        <span className="admin__user-text">
                          <span className="admin__user-name">{t.user_name}</span>
                          <span className="admin__user-email">{t.user_email}</span>
                        </span>
                      ) : (
                        <span className="admin__user-text">
                          <span>{t.customer_name}</span>
                          <span className="admin__user-email">No account</span>
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`admin__txn-status admin__txn-status--${t.status}`}>
                        {STATUS_LABELS[t.status] ?? t.status}
                      </span>
                    </td>
                    <td className="m3-table__nowrap">{formatDateTime(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination {...list} label="Transactions pages" />
      </div>
      {openId !== null && <TransactionDetailsDialog id={openId} onClose={() => setOpenId(null)} />}
      {purgeConfirm && (
        <Dialog title="Delete old transactions?" onClose={() => setPurgeConfirm(null)}>
          <p>
            Permanently delete {purgeConfirm.transactions} transaction(s) created before{' '}
            {formatDateTime(purgeConfirm.cutoff)}? This can’t be undone.
          </p>
          <div className="admin__dialog-actions">
            <button type="button" className="m3-button m3-button--tonal" onClick={() => setPurgeConfirm(null)}>
              Cancel
            </button>
            <button type="button" className="m3-button admin__dialog-danger" onClick={() => void confirmPurge()}>
              Delete
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

const VISIBILITY_LABELS: Record<AlertFormValues['visibility'], string> = {
  dashboard: 'Dashboard',
  public: 'Public',
};

const alertTargetLabel = (t: AlertTarget) => `${t.display_name} - ${t.email}`;

// Same contents as the dashboard Alerts tab, but across every user: create for a
// picked recipient, and edit/delete any alert.
function AllAlertsPanel() {
  const [alerts, setAlerts] = useState<AdminAlert[] | null>(null);
  const [targets, setTargets] = useState<AlertTarget[]>([]);
  const [targetText, setTargetText] = useState('');
  const [editing, setEditing] = useState<AdminAlert | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ alerts: AdminAlert[] }>('/admin/alerts')
      .then((body) => {
        if (!cancelled) setAlerts(body.alerts);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    apiFetch<{ users: AlertTarget[] }>('/admin/alert-targets')
      .then((body) => setTargets(body.users))
      .catch((err) => console.error('Loading alert targets failed', err));
  }, []);

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      setTick((t) => t + 1);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleCreate(values: AlertFormValues) {
    const target = targets.find((t) => alertTargetLabel(t) === targetText.trim());
    if (!target) {
      setNotice(null);
      setError('Pick a user from the suggestions.');
      return;
    }
    await run(
      () => apiFetch(`/admin/users/${target.id}/alerts`, { method: 'POST', body: JSON.stringify(values) }),
      `Alert sent to ${target.display_name}.`,
    );
  }

  return (
    <>
      {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
      {notice && <p className="m3-banner" role="status">{notice}</p>}

      <details className="m3-card m3-collapsible">
        <summary className="m3-card__title">New alert</summary>
        <label className="m3-field">
          Target User
          <input
            value={targetText}
            onChange={(e) => setTargetText(e.target.value)}
            list="admin-alert-targets"
            autoComplete="off"
            placeholder="Name or email"
            required
          />
          <datalist id="admin-alert-targets">
            {targets.map((t) => (
              <option key={t.id} value={alertTargetLabel(t)} />
            ))}
          </datalist>
        </label>
        <AlertEditor submitLabel="Create alert" onSubmit={handleCreate} />
      </details>

      <div className="m3-card m3-card--flush">
        <div className="admin__toolbar">
          <h2 className="m3-card__title">All alerts ({alerts?.length ?? '…'})</h2>
        </div>
        {!alerts ? (
          <p className="m3-supporting admin__empty">Loading…</p>
        ) : alerts.length === 0 ? (
          <p className="m3-supporting admin__empty">No alerts.</p>
        ) : (
          <div className="m3-table-wrap">
            <table className="m3-table admin__table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Recipient</th>
                  <th>Type</th>
                  <th>Visibility</th>
                  <th>Message</th>
                  <th>From</th>
                  <th>Created</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.id}>
                    <td>{alert.id}</td>
                    <td>
                      <span className="admin__user-text">
                        <span className="admin__user-name">{alert.user_name}</span>
                        <span className="admin__user-email">{alert.user_email}</span>
                      </span>
                    </td>
                    <td>
                      <span className={`dashboard__alert-type dashboard__alert-type--${alert.type}`}>{alert.type}</span>
                    </td>
                    <td className="m3-table__nowrap">{VISIBILITY_LABELS[alert.visibility]}</td>
                    <td>
                      <RichText html={alert.body_html} lines={2} />
                    </td>
                    <td>{alert.created_by_name ?? '—'}</td>
                    <td className="m3-table__nowrap">{formatDateTime(alert.created_at)}</td>
                    <td>
                      <div className="admin__actions">
                        <button type="button" className="admin__action" onClick={() => setEditing(alert)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="admin__action admin__action--danger"
                          onClick={() => void run(() => apiFetch(`/alerts/${alert.id}`, { method: 'DELETE' }), 'Alert deleted.')}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <Dialog title={`Edit alert #${editing.id}`} onClose={() => setEditing(null)}>
          <AlertEditor
            initial={{ type: editing.type, visibility: editing.visibility, body_html: editing.body_html }}
            submitLabel="Save"
            onSubmit={async (values) => {
              const target = editing;
              setEditing(null);
              await run(
                () => apiFetch(`/alerts/${target.id}`, { method: 'PUT', body: JSON.stringify(values) }),
                'Alert updated.',
              );
            }}
          />
        </Dialog>
      )}
    </>
  );
}

// What the confirm dialog will delete: every expired session, or the checked rows.
type SessionsDeletion = { kind: 'expired' } | { kind: 'selected'; ids: number[] };

function SessionsPanel() {
  const [body, setBody] = useState<SessionsBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SessionsDeletion | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SessionsBody>('/admin/sessions')
      .then((result) => {
        if (!cancelled) {
          setBody(result);
          setSelected(new Set());
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  function toggle(ids: number[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function runDeletion(deletion: SessionsDeletion) {
    setConfirming(null);
    setError(null);
    setNotice(null);
    setDeleting(true);
    try {
      if (deletion.kind === 'expired') {
        const { deleted } = await apiFetch<{ deleted: number }>('/admin/sessions/expired', { method: 'DELETE' });
        setNotice(`Deleted ${deleted} expired session(s).`);
      } else {
        const { deleted } = await apiFetch<{ deleted: number }>('/admin/sessions/delete', {
          method: 'POST',
          body: JSON.stringify({ ids: deletion.ids }),
        });
        const skipped = deletion.ids.length - deleted;
        setNotice(`Deleted ${deleted} session(s).${skipped > 0 ? ' Your own session was kept.' : ''}`);
      }
      setTick((t) => t + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  const selectedIn = (sessions?: AdminSession[]) => (sessions ?? []).filter((s) => selected.has(s.id)).map((s) => s.id);
  const activeSelected = selectedIn(body?.active);
  const expiredSelected = selectedIn(body?.expired);

  function deleteSelectedButton(ids: number[]) {
    return (
      <button
        type="button"
        className="admin__action admin__action--danger"
        onClick={() => setConfirming({ kind: 'selected', ids })}
        disabled={deleting || ids.length === 0}
        title="Delete the checked sessions"
      >
        {deleting ? 'Deleting…' : `Delete${ids.length ? ` (${ids.length})` : ''}`}
      </button>
    );
  }

  return (
    <>
      {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
      {notice && <p className="m3-banner" role="status">{notice}</p>}
      <CollapsibleCard
        title={`Active (${body?.active_total ?? '…'})`}
        actions={deleteSelectedButton(activeSelected)}
      >
        <SessionsTable
          sessions={body?.active}
          total={body?.active_total}
          empty="No active sessions."
          selected={selected}
          onToggle={toggle}
        />
      </CollapsibleCard>
      <CollapsibleCard
        className="admin__sessions-expired"
        title={`Expired (${body?.expired_total ?? '…'})`}
        actions={
          <>
            {deleteSelectedButton(expiredSelected)}
            <button
              type="button"
              className="admin__action admin__action--danger"
              onClick={() => setConfirming({ kind: 'expired' })}
              disabled={deleting || !body?.expired_total}
              title="Delete every expired session"
            >
              Delete all
            </button>
          </>
        }
      >
        <SessionsTable
          sessions={body?.expired}
          total={body?.expired_total}
          empty="No expired sessions."
          selected={selected}
          onToggle={toggle}
        />
      </CollapsibleCard>
      {confirming && body && (
        <Dialog
          title={confirming.kind === 'expired' ? 'Delete expired sessions?' : 'Delete selected sessions?'}
          onClose={() => setConfirming(null)}
        >
          <p>
            {confirming.kind === 'expired'
              ? `Permanently delete ${body.expired_total} expired session(s)? Active sessions aren’t affected.`
              : `Permanently delete ${confirming.ids.length} session(s)? Active ones are signed out immediately; your own session is kept.`}
          </p>
          <div className="admin__dialog-actions">
            <button type="button" className="m3-button m3-button--tonal" onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button type="button" className="m3-button admin__dialog-danger" onClick={() => void runDeletion(confirming)}>
              Delete
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

// Flush card whose table body is collapsed by default. Not a <details>: the
// toolbar actions sit in the header and must not toggle it.
function CollapsibleCard({
  title,
  actions,
  className,
  children,
}: {
  title: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`m3-card m3-card--flush${className ? ` ${className}` : ''}`}>
      <div className="admin__toolbar">
        <h2 className="m3-card__title">
          <button type="button" className="admin__collapse" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {title}
          </button>
        </h2>
        {actions}
      </div>
      {open && children}
    </div>
  );
}

// Header checkbox: checked when every row is, indeterminate when only some are.
function SelectAllCheckbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate: boolean; onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="admin__checkbox"
      aria-label="Select all rows"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function SessionsTable({
  sessions,
  total,
  empty,
  selected,
  onToggle,
}: {
  sessions?: AdminSession[];
  total?: number;
  empty: string;
  selected: Set<number>;
  onToggle: (ids: number[], checked: boolean) => void;
}) {
  if (!sessions) return <p className="m3-supporting admin__empty">Loading…</p>;
  if (sessions.length === 0) return <p className="m3-supporting admin__empty">{empty}</p>;
  const checkedCount = sessions.filter((s) => selected.has(s.id)).length;
  return (
    <>
      <div className="m3-table-wrap">
        <table className="m3-table admin__table">
          <thead>
            <tr>
              <th className="admin__select-cell">
                <SelectAllCheckbox
                  checked={checkedCount === sessions.length}
                  indeterminate={checkedCount > 0 && checkedCount < sessions.length}
                  onChange={(checked) => onToggle(sessions.map((s) => s.id), checked)}
                />
              </th>
              <th>#</th>
              <th>User</th>
              <th>Role</th>
              <th>Signed in</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td className="admin__select-cell">
                  <input
                    type="checkbox"
                    className="admin__checkbox"
                    aria-label={`Select session ${s.id}`}
                    checked={selected.has(s.id)}
                    onChange={(e) => onToggle([s.id], e.target.checked)}
                  />
                </td>
                <td>{s.id}</td>
                <td>
                  <span className="admin__user-text">
                    <span className="admin__user-name">{s.user_name}</span>
                    <span className="admin__user-email">
                      {s.user_email}
                      {s.impersonator_name && ` · masqueraded by ${s.impersonator_name}`}
                    </span>
                  </span>
                </td>
                <td>{s.role_name}</td>
                <td className="m3-table__nowrap">{formatDateTime(s.created_at)}</td>
                <td className="m3-table__nowrap">{formatDateTime(s.expires_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total !== undefined && total > sessions.length && (
        <p className="m3-supporting admin__empty">Showing the newest {sessions.length} of {total}.</p>
      )}
    </>
  );
}

function TransactionDetailsDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const [detail, setDetail] = useState<AdminTransactionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ transaction: AdminTransactionDetail }>(`/plugins/workflow/admin/transactions/${id}`)
      .then((body) => setDetail(body.transaction))
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  return (
    <Dialog title={`Order #${id}`} onClose={onClose}>
      {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
      {!detail && !error && <p className="m3-supporting">Loading…</p>}
      {detail && (
        <>
          <dl className="admin__details">
            <dt>Code</dt>
            <dd><code>{detail.code}</code></dd>
            <dt>Status</dt>
            <dd>
              <span className={`admin__txn-status admin__txn-status--${detail.status}`}>
                {STATUS_LABELS[detail.status] ?? detail.status}
              </span>
            </dd>
            <dt>Owner</dt>
            <dd>{detail.owner_name} <span className="admin__user-email">{detail.owner_email}</span></dd>
            <dt>Customer</dt>
            <dd>
              {detail.customer_name}
              {detail.user_id ? (
                <span className="admin__user-email"> · account: {detail.user_name} ({detail.user_email})</span>
              ) : (
                <span className="admin__user-email"> · no account</span>
              )}
            </dd>
            <dt>Contact</dt>
            <dd>{detail.customer_contact ?? '—'}</dd>
            <dt>Control number</dt>
            <dd>{detail.control_number ?? '—'}</dd>
            <dt>Weight</dt>
            <dd>{detail.weight_kg === null ? '—' : `${detail.weight_kg} kg`}</dd>
            <dt>Registered</dt>
            <dd>{formatDateTime(detail.created_at)}</dd>
            <dt>Updated</dt>
            <dd>{formatDateTime(detail.updated_at)}</dd>
            <dt>Done</dt>
            <dd>{detail.done_at ? formatDateTime(detail.done_at) : '—'}</dd>
          </dl>
          <h3 className="m3-section-title">Description</h3>
          {detail.description ? (
            <RichText html={detail.description} />
          ) : (
            <p className="m3-supporting">No description.</p>
          )}
        </>
      )}
    </Dialog>
  );
}

const PAGE_SIZE = 10;

interface UsersResponse {
  users: AdminUser[];
  stats: { total: number; active: number; owners: number; customers: number; role_names: string[] };
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

// One server-side page of a list endpoint that answers { total, page_size, ... }
// for ?page= plus the given filters (empty ones are left out). Changing a
// filter goes back to page 1; a page left empty (e.g. after a deactivation
// under an "Active" filter) steps back to the last page that has rows.
function usePagedList<T>(path: string, filters: Record<string, string>) {
  const filterKey = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const [body, setBody] = useState<(T & { total: number; page_size: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const qs = filterKey ? `${filterKey}&page=${page}` : `page=${page}`;
    apiFetch<T & { total: number; page_size: number }>(`${path}?${qs}`)
      .then((next) => {
        if (cancelled) return;
        const lastPage = Math.max(1, Math.ceil(next.total / next.page_size));
        if (page > lastPage) {
          setPageState({ key: filterKey, page: lastPage });
          return;
        }
        setError(null);
        setBody(next);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [path, filterKey, page, tick]);

  return {
    body,
    error,
    page,
    total: body?.total ?? 0,
    pageCount: body ? Math.max(1, Math.ceil(body.total / body.page_size)) : 1,
    setPage: (next: number) => setPageState({ key: filterKey, page: next }),
    reload: () => setTick((t) => t + 1),
  };
}

function Pagination({
  page,
  pageCount,
  total,
  setPage,
  label,
}: {
  page: number;
  pageCount: number;
  total: number;
  setPage: (page: number) => void;
  label: string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <nav className="admin__pagination" aria-label={label}>
      <span className="admin__pagination-info">
        {from}–{to} of {total}
      </span>
      {pageCount > 1 && (
        <span className="admin__pagination-controls">
          <button type="button" className="admin__action" onClick={() => setPage(page - 1)} disabled={page === 1}>
            ‹ Prev
          </button>
          <span className="admin__pagination-page" aria-current="page">
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            className="admin__action"
            onClick={() => setPage(page + 1)}
            disabled={page === pageCount}
          >
            Next ›
          </button>
        </span>
      )}
    </nav>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <li className="admin__stat">
      <span className="admin__stat-value">{value ?? '—'}</span>
      <span className="admin__stat-label">{label}</span>
    </li>
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
