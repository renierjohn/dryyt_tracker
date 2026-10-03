import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import AppShell from '../components/AppShell';
import '../assets/sass/auth-form.scss';

export default function Register({ onRegistered }: { onRegistered: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: displayName }),
      });
      await onRegistered();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <AppShell active="register">
      <form className="auth-form" onSubmit={handleSubmit}>
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
        <button className="auth-form__button" type="submit">Register</button>
      </form>
    </AppShell>
  );
}
