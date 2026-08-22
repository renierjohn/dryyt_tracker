import { type FormEvent, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = await apiFetch<{ ok: boolean; resetLink?: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSubmitted(true);
      setResetLink(body.resetLink ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  if (submitted) {
    return (
      <div>
        <p>If that email exists, a reset link has been generated.</p>
        {resetLink && (
          <p>
            Dev mode (no email service yet) — reset link: <a href={resetLink}>{resetLink}</a>
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Forgot password</h1>
      {error && <p role="alert">{error}</p>}
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <button type="submit">Send reset link</button>
    </form>
  );
}
