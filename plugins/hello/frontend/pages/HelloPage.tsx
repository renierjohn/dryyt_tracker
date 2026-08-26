import { useState } from 'react';
import { apiFetch, ApiError } from '../../../sdk';

export default function HelloPage() {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePing() {
    setError(null);
    try {
      const body = await apiFetch<{ count: number }>('/plugins/hello/ping', { method: 'POST' });
      setCount(body.count);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '64px auto', padding: '0 20px', textAlign: 'center' }}>
      <h1>Hello plugin</h1>
      <p>
        A trivial example plugin proving the frontend, backend, and migration wiring
        under <code>/plugins</code> works end to end.
      </p>
      <button onClick={handlePing}>Ping backend</button>
      {count !== null && <p>Visit count: {count}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
