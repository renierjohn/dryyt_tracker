import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import AppShell from '../components/AppShell';
import { useTurnstile } from '../lib/useTurnstile';
import '../assets/sass/auth-form.scss';

export default function Register({ onRegistered }: { onRegistered: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { turnstileRef, startTurnstile, getTurnstileToken, resetTurnstile } = useTurnstile('register');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const turnstile_token = await getTurnstileToken();
      await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: displayName, turnstile_token }),
      });
      await onRegistered();
      navigate('/');
    } catch (err) {
      resetTurnstile();
      setError(err instanceof ApiError ? err.code : err instanceof Error ? err.message : 'unknown_error');
    }
  }

  return (
    <AppShell active="register">
      <form className="auth-form" onSubmit={handleSubmit} onFocus={(e) => e.target instanceof HTMLInputElement && startTurnstile()}>
        <h1>Register</h1>
        {error && <p className="auth-form__error" role="alert">{error}</p>}
        <label>
          Owner name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <div ref={turnstileRef} className="auth-form__turnstile" />
        {/* Static pages (public/), so plain links rather than router <Link>s. */}
        <p className="auth-form__legal">
          By registering you agree to the <a href="/terms" target="_blank" rel="noopener">Terms &amp; Conditions</a> and
          the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
        </p>
        <button className="auth-form__button" type="submit">Register</button>
      </form>
    </AppShell>
  );
}
