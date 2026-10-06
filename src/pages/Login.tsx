import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import { isSuperadmin } from '../lib/permissions';
import type { AuthUser } from '../lib/useCurrentUser';
import AppShell from '../components/AppShell';
import { useTurnstile } from '../lib/useTurnstile';
import '../assets/sass/auth-form.scss';

export default function Login({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { turnstileRef, startTurnstile, getTurnstileToken, resetTurnstile } = useTurnstile('login');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const turnstile_token = await getTurnstileToken();
      const { user } = await apiFetch<{ user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, turnstile_token }),
      });
      await onLoggedIn();
      navigate(isSuperadmin(user) ? '/admin' : '/dashboard', { replace: true });
    } catch (err) {
      resetTurnstile();
      setError(err instanceof ApiError ? err.code : err instanceof Error ? err.message : 'unknown_error');
    }
  }

  return (
    <AppShell active="login">
      <form className="auth-form" onSubmit={handleSubmit} onFocus={(e) => e.target instanceof HTMLInputElement && startTurnstile()}>
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
        <div ref={turnstileRef} className="auth-form__turnstile" />
        <button className="auth-form__button" type="submit">Log in</button>
        <p className="auth-form__footer">
          <a href="/forgot-password">Forgot password?</a> · <a href="/register">Register</a>
        </p>
      </form>
    </AppShell>
  );
}
