import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../../../sdk';

interface Transaction {
  id: number;
  code: string;
  customer_name: string;
  customer_contact: string | null;
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
const STATUSES = Object.keys(STATUS_LABELS);

const cellStyle = { padding: '8px 12px', borderBottom: '1px solid #e5e4e7', textAlign: 'left' as const };

export default function WorkflowAdminPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);

  async function loadTransactions() {
    try {
      const body = await apiFetch<{ transactions: Transaction[] }>('/plugins/workflow/transactions');
      setTransactions(body.transactions);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTransactions();
  }, []);

  async function handleStatusChange(id: number, status: string) {
    try {
      await apiFetch(`/plugins/workflow/transactions/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      await loadTransactions();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 20px 64px' }}>
      <h1>Workflow</h1>
      {error && <p role="alert">{error}</p>}
      <RegisterTransactionForm
        onCreated={async (code) => {
          setLastCode(code);
          await loadTransactions();
        }}
      />
      {lastCode && (
        <p>
          Registered — code for the customer: <strong>{lastCode}</strong>
        </p>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
              <td style={cellStyle}>
                <select value={t.status} onChange={(e) => handleStatusChange(t.id, e.target.value)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegisterTransactionForm({ onCreated }: { onCreated: (code: string) => Promise<void> }) {
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = await apiFetch<{ transaction: { code: string } }>('/plugins/workflow/transactions', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: customerName,
          customer_contact: customerContact || undefined,
          description: description || undefined,
        }),
      });
      setCustomerName('');
      setCustomerContact('');
      setDescription('');
      await onCreated(body.transaction.code);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 32, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <h2 style={{ flexBasis: '100%' }}>Register transaction</h2>
      {error && <p role="alert" style={{ flexBasis: '100%' }}>{error}</p>}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        Customer name
        <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        Contact (optional)
        <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        Description (optional)
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button type="submit" style={{ alignSelf: 'flex-end' }}>Register</button>
    </form>
  );
}
