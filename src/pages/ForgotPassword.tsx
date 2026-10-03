import { type FormEvent, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import AppShell from '../components/AppShell';
import '../assets/sass/auth-form.scss';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = await apiFetch<{ ok: boolean; resetLink?: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSubmitted(true);
      setResetLink(body.resetLink ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell active="login">
      {submitted ? (
        <div className="auth-form" role="status">
          <h1>Check your email</h1>
          <p className="auth-form__hint">
            If an account exists for <strong>{email}</strong>, we've sent a link to reset your password.
          </p>
          {resetLink && (
            <p className="auth-form__dev">
              Dev mode (no email service yet) — <a href={resetLink}>open reset link</a>
            </p>
          )}
          <p className="auth-form__footer">
            <a href="/login">Back to log in</a>
          </p>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit}>
          <h1>Forgot password</h1>
          <p className="auth-form__hint">Enter your account email and we'll send you a link to reset your password.</p>
          {error && <p className="auth-form__error" role="alert">{error}</p>}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <button className="auth-form__button" type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="auth-form__footer">
            <a href="/login">Back to log in</a>
          </p>
        </form>
      )}
    </AppShell>
  );
}
