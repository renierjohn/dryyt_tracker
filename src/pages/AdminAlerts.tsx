import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import AlertEditor, { type AlertFormValues } from '../components/AlertEditor';
import '../assets/sass/admin-console.scss';

export default function AdminAlerts() {
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(values: AlertFormValues) {
    setError(null);
    setSent(false);
    const id = Number(targetId);
    if (!Number.isInteger(id) || id <= 0) {
      setError('invalid_user_id');
      return;
    }
    try {
      await apiFetch(`/admin/users/${id}/alerts`, { method: 'POST', body: JSON.stringify(values) });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <div className="admin-console">
      <Link className="back-link" to="/">← Home</Link>
      <h1>Send alert</h1>
      {error && <p className="admin-console__error" role="alert">{error}</p>}
      {sent && <p>Alert sent.</p>}
      <label>
        Target user ID
        <input
          type="number"
          value={targetId}
          onChange={(e) => { setTargetId(e.target.value); setSent(false); }}
          min={1}
          required
        />
      </label>
      <AlertEditor submitLabel="Send alert" onSubmit={handleSubmit} />
    </div>
  );
}
