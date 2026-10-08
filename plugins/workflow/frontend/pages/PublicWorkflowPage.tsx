import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, ApiError, useSession, AppShell, RichText, ScrollHintWrap, StoreInfo, SocialLinks, type SocialLink, type StoreDetails } from '../../../sdk';
import { formatDateTime } from '../datetime';
import WorkflowAdminPage from './WorkflowAdminPage';
import TransactionDialog from '../components/TransactionDialog';
import '../workflow.scss';

// Logged-out visitors get code/customer_name/description as null (and no
// done_at), as do 'user'-role customers and other owners on transactions that
// aren't theirs —
// see the backend route; those cells render a blurred placeholder.
interface Transaction {
  id: number;
  // Shown to everyone (see the backend route); older transactions have none.
  control_number: string | null;
  code: string | null;
  customer_name: string | null;
  description: string | null;
  status: string;
  created_at: string;
  done_at?: string | null;
}

interface PublicAlert {
  id: number;
  type: 'info' | 'success' | 'warning' | 'danger';
  body_html: string;
}

function Hidden({ width }: { width: string }) {
  return (
    <span className="m3-redacted" aria-label="Hidden">
      {width}
    </span>
  );
}

// Dismissed alert ids, remembered per browser. Storage can be unavailable
// (private mode, blocked site data) — then dismissals last for the visit only.
const DISMISSED_KEY = 'dismissedAlerts';

function loadDismissed(): Set<number> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<number>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

const STATUS_LABELS: Record<string, string> = {
  hold: 'On hold',
  in_progress: 'In progress',
  done: 'Done',
  ready_to_pickup: 'Ready for pickup',
  end: 'End',
};

// Reached from an owner's card on the homepage (src/components/OwnersList.tsx).
// Anonymous or any other signed-in visitor gets a read-only view — no
// create/status-edit form. But when the signed-in visitor IS the owner this
// page belongs to (they followed their own /owner/<name> link), it renders
// the full interactive WorkflowAdminPage instead, since that page's own
// session-scoped /transactions endpoint resolves to exactly this owner's data.
export default function PublicWorkflowPage() {
  const { identifier } = useParams<{ identifier: string }>();
  const { user, refresh } = useSession();
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [store, setStore] = useState<StoreDetails | null>(null);
  const [contact, setContact] = useState<{ email: string; contact_number: string | null } | null>(null);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<PublicAlert[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(loadDismissed);
  const [error, setError] = useState<string | null>(null);
  const [openTransaction, setOpenTransaction] = useState<Transaction | null>(null);

  useEffect(() => {
    if (!identifier) return;
    async function load() {
      try {
        const body = await apiFetch<{ owner_id: number; owner_display_name: string; transactions: Transaction[] }>(
          `/plugins/workflow/owners/${encodeURIComponent(identifier!)}/transactions`,
        );
        setOwnerId(body.owner_id);
        setOwnerName(body.owner_display_name);
        setTransactions(body.transactions);
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'unknown_error');
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [identifier]);

  useEffect(() => {
    if (!identifier) return;
    let cancelled = false;
    void apiFetch<{
      store: StoreDetails;
      contact: { email: string; contact_number: string | null };
      social_links: SocialLink[];
      avatar_key: string | null;
      alerts: PublicAlert[];
    }>(
      `/owners/${encodeURIComponent(identifier)}/store`,
    )
      .then((body) => {
        if (cancelled) return;
        setStore(body.store);
        setContact(body.contact);
        setSocialLinks(body.social_links);
        setAvatarKey(body.avatar_key);
        setAlerts(body.alerts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [identifier]);

  // Applies this owner's own chosen flavor while viewing their page — regardless
  // of the visitor's own theme (if any) or lack of a session entirely.
  useEffect(() => {
    if (!identifier) return;
    let cancelled = false;
    void apiFetch<{ flavor: string }>(`/plugins/theme/owners/${encodeURIComponent(identifier)}`)
      .then((body) => {
        if (!cancelled) document.documentElement.dataset.theme = body.flavor;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [identifier]);

  function dismissAlert(id: number) {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      saveDismissed(next);
      return next;
    });
  }

  if (user && ownerId !== null && user.id === ownerId) {
    return <WorkflowAdminPage />;
  }

  // End (done_at) is for signed-in staff — hidden from anonymous visitors,
  // 'user'-role customers and other owners (their own page renders above).
  const showEnd = user !== null && user.role_name !== 'user' && user.role_name !== 'owner';

  return (
    <AppShell active="home" user={user} refresh={refresh} contentClassName="m3-page">
      <h1 className="m3-headline store-page__name">{ownerName ?? 'Store'}</h1>
      {contact && (
        <p className="store-page__contact">
          <a href={`mailto:${contact.email}`}>{contact.email}</a>
          {contact.contact_number && (
            <a href={`tel:${contact.contact_number.replace(/[^\d+]/g, '')}`}>{contact.contact_number}</a>
          )}
          <SocialLinks links={socialLinks} />
        </p>
      )}
      <section>
        {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
        {store && <StoreInfo store={store} avatarKey={avatarKey} name={ownerName} />}
        {alerts
          .filter((alert) => !dismissed.has(alert.id))
          .map((alert) => (
            <div
              key={alert.id}
              className={`m3-alert m3-alert--${alert.type} m3-alert--dismissible`}
              role={alert.type === 'danger' || alert.type === 'warning' ? 'alert' : 'note'}
            >
              {/* Sanitized server-side on write (worker/sanitize.ts). */}
              <div dangerouslySetInnerHTML={{ __html: alert.body_html }} />
              <button
                type="button"
                className="m3-alert__close"
                aria-label="Dismiss alert"
                onClick={() => dismissAlert(alert.id)}
              >
                ×
              </button>
            </div>
          ))}
        <div className="m3-card m3-card--flush">
          <h2 className="m3-card__title">Transactions</h2>
          {transactions.length === 0 ? (
            <p className="m3-supporting" style={{ margin: '0 20px 12px' }}>No transactions yet.</p>
          ) : (
            <ScrollHintWrap>
              <table className="m3-table">
                <thead>
                  <tr>
                    <th>Control Number</th>
                    <th>Customer</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Start</th>
                    {showEnd && <th>End</th>}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td>{t.control_number ?? '—'}</td>
                      {t.code !== null ? (
                        <>
                          <td>{t.customer_name}</td>
                          <td>
                            <button type="button" className="txn-desc" onClick={() => setOpenTransaction(t)}>
                              {t.description ? (
                                <RichText as="span" html={t.description} lines={2} />
                              ) : (
                                <span className="txn-desc__empty">View details</span>
                              )}
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td><Hidden width="Customer name" /></td>
                          <td><Hidden width="Order description" /></td>
                        </>
                      )}
                      <td>{STATUS_LABELS[t.status] ?? t.status}</td>
                      <td className="m3-table__nowrap">{formatDateTime(t.created_at)}</td>
                      {showEnd && <td className="m3-table__nowrap">{formatDateTime(t.done_at ?? null)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollHintWrap>
          )}
        </div>
      </section>
      {openTransaction && <TransactionDialog transaction={openTransaction} onClose={() => setOpenTransaction(null)} />}
    </AppShell>
  );
}
