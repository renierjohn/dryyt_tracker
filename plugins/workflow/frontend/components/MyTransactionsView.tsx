import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError, useSession, AppShell, RichText, ScrollHintWrap } from '../../../sdk';
import TransactionDialog from './TransactionDialog';
import { STATUS_LABELS } from '../status';
import { formatDateTime } from '../datetime';
import '../workflow.scss';

interface MyTransaction {
  id: number;
  control_number: string | null;
  owner_name: string;
  code: string;
  weight_kg: number | null;
  customer_name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  done_at: string | null;
}

// Read-only Tracker for a customer: only the transactions registered for them.
export default function MyTransactionsView() {
  const { user, refresh } = useSession();
  const [transactions, setTransactions] = useState<MyTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openTransaction, setOpenTransaction] = useState<MyTransaction | null>(null);
  // Rounded to 2 decimals to drop float noise (0.1 + 0.2).
  const totalWeight = Math.round(transactions.reduce((sum, t) => sum + (t.weight_kg ?? 0), 0) * 100) / 100;

  useEffect(() => {
    apiFetch<{ transactions: MyTransaction[] }>('/plugins/workflow/my-transactions')
      .then((body) => setTransactions(body.transactions))
      .catch((err) => setError(err instanceof ApiError ? err.code : 'unknown_error'));
  }, []);

  return (
    <AppShell active="tracker" user={user} refresh={refresh} contentClassName="m3-page">
      <h1 className="m3-headline">Tracker</h1>
      <section>
        {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
        <div className="m3-card m3-card--flush">
          <h2 className="m3-card__title">Your transactions</h2>
          {transactions.length === 0 ? (
            <p className="m3-supporting" style={{ margin: '0 20px 12px' }}>No transactions yet.</p>
          ) : (
            <ScrollHintWrap>
              <table className="m3-table">
                <thead>
                  <tr>
                    <th>Control #</th>
                    <th>Owner</th>
                    <th>Code</th>
                    <th>Weight (kg)</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Start</th>
                    <th>End</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td>{t.control_number ?? '—'}</td>
                      <td>{t.owner_name}</td>
                      <td>
                        <Link to={`/track?${new URLSearchParams({ code: t.code })}`} title="Track this order">
                          <code>{t.code}</code>
                        </Link>
                      </td>
                      <td>{t.weight_kg ?? '—'}</td>
                      <td>
                        <button type="button" className="txn-desc" onClick={() => setOpenTransaction(t)}>
                          {t.description ? (
                            <RichText as="span" html={t.description} lines={2} />
                          ) : (
                            <span className="txn-desc__empty">View details</span>
                          )}
                        </button>
                      </td>
                      <td>{STATUS_LABELS[t.status] ?? t.status}</td>
                      <td className="m3-table__nowrap">{formatDateTime(t.created_at)}</td>
                      <td className="m3-table__nowrap">{formatDateTime(t.done_at)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="txn-total">
                    <th colSpan={3}>Total weight</th>
                    <th className="txn-total__value">{totalWeight}</th>
                    <th colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </ScrollHintWrap>
          )}
        </div>
      </section>
      {openTransaction && <TransactionDialog transaction={openTransaction} onClose={() => setOpenTransaction(null)} />}
    </AppShell>
  );
}
