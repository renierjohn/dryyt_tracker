import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import '../assets/sass/track.scss';

interface TrackedTransaction {
  code: string;
  customer_name: string;
  description: string | null;
  status: string;
  updated_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  hold: 'On hold',
  in_progress: 'In progress',
  done: 'Done',
  ready_to_pickup: 'Ready for pickup',
};

const normalizeCode = (s: string) => s.trim().toUpperCase();

export default function Track() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get('code') ?? '');
  const [transaction, setTransaction] = useState<TrackedTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup(lookupCode: string) {
    setLoading(true);
    setError(null);
    setTransaction(null);
    try {
      const body = await apiFetch<{ transaction: TrackedTransaction }>(
        `/plugins/workflow/track/${encodeURIComponent(lookupCode)}`,
      );
      setTransaction(body.transaction);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'not_found' : 'unknown_error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initial = searchParams.get('code');
    if (initial) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void lookup(normalizeCode(initial));
    }
    // Only run on mount — the form's own submit handler drives later lookups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = normalizeCode(code);
    if (!trimmed) return;
    setSearchParams({ code: trimmed });
    void lookup(trimmed);
  }

  return (
    <div className="track">
      <h1>Track your order</h1>
      <form className="track__form" onSubmit={handleSubmit}>
        <label>
          Order code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. 7K4PXM"
            maxLength={6}
            required
          />
        </label>
        <button type="submit">Track</button>
      </form>

      {loading && <p>Looking up…</p>}
      {error === 'not_found' && <p role="alert">No order found for that code.</p>}
      {error === 'unknown_error' && <p role="alert">Something went wrong — try again.</p>}

      {transaction && (
        <div className="track__result">
          <p className="track__status">{STATUS_LABELS[transaction.status] ?? transaction.status}</p>
          <p>Customer: {transaction.customer_name}</p>
          {transaction.description && <p>{transaction.description}</p>}
          <p className="track__updated">Last updated: {new Date(transaction.updated_at.replace(' ', 'T') + 'Z').toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}
