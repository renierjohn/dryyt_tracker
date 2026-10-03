import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch, ApiError, useCurrentUser } from '../../../sdk';
import WorkflowAdminPage from './WorkflowAdminPage';

interface Transaction {
  id: number;
  code: string;
  customer_name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  hold: 'On hold',
  in_progress: 'In progress',
  done: 'Done',
  ready_to_pickup: 'Ready for pickup',
};

const cellStyle = { padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' as const };

// Reached from an owner's card on the homepage (src/components/OwnersList.tsx).
// Anonymous or any other signed-in visitor gets a read-only view — no
// create/status-edit form. But when the signed-in visitor IS the owner this
// page belongs to (they followed their own /owner/<name> link), it renders
// the full interactive WorkflowAdminPage instead, since that page's own
// session-scoped /transactions endpoint resolves to exactly this owner's data.
export default function PublicWorkflowPage() {
  const { identifier } = useParams<{ identifier: string }>();
  const { user, refresh } = useCurrentUser();
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout request failed', err);
    }
    await refresh();
  }

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

  const bottomNav = (
    <nav className="tab-bar">
      <Link className="tab" to="/">Home</Link>
      {user ? (
        <button className="tab tab--primary" onClick={handleLogout}>Log out</button>
      ) : (
        <Link className="tab tab--primary" to="/login">Log in</Link>
      )}
    </nav>
  );

  if (user && ownerId !== null && user.id === ownerId) {
    return (
      <>
        <WorkflowAdminPage />
        {bottomNav}
      </>
    );
  }

  return (
    <div style={{ width: '100%', maxWidth: 960, boxSizing: 'border-box', margin: '0 auto', padding: '32px 20px 64px' }}>
      <h1>{ownerName ? `${ownerName}'s transactions` : 'Workflow'}</h1>
      {error && <p role="alert">{error}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={cellStyle}>Code</th>
              <th style={cellStyle}>Customer</th>
              <th style={cellStyle}>Description</th>
              <th style={cellStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id}>
                <td style={cellStyle}><code>{t.code}</code></td>
                <td style={cellStyle}>{t.customer_name}</td>
                <td style={cellStyle}>{t.description ?? ''}</td>
                <td style={cellStyle}>{STATUS_LABELS[t.status] ?? t.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bottomNav}
    </div>
  );
}
