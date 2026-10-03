import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import { isSuperadmin } from '../lib/permissions';
import type { AuthUser } from '../lib/useCurrentUser';
import AppShell from '../components/AppShell';
import '../assets/sass/auth-form.scss';

export default function Login({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { user } = await apiFetch<{ user: AuthUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      await onLoggedIn();
      navigate(isSuperadmin(user) ? '/admin' : '/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <AppShell active="login">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Log in</h1>
        {error && <p className="auth-form__error" role="alert">{error}</p>}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="auth-form__button" type="submit">Log in</button>
        <p className="auth-form__footer">
          <a href="/forgot-password">Forgot password?</a> · <a href="/register">Register</a>
        </p>
      </form>
    </AppShell>
  );
}
