import { type FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Reset password</h1>
      {error && <p role="alert">{error}</p>}
      <label>
        New password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </label>
      <button type="submit">Reset password</button>
    </form>
  );
}
