import { type FormEvent, useState } from 'react';
import { apiFetch } from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = await apiFetch<{ ok: boolean; resetLink?: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    setSubmitted(true);
    setResetLink(body.resetLink ?? null);
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
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <button type="submit">Send reset link</button>
    </form>
  );
}
