import { useEffect, useState } from 'react';
import type { AuthUser } from '../lib/useCurrentUser';
import { apiFetch, ApiError } from '../lib/api';
import AppShell from '../components/AppShell';
import Autocomplete from '../components/Autocomplete';
import AlertEditor, { type AlertFormValues } from '../components/AlertEditor';

interface AlertTarget {
  id: number;
  display_name: string;
  email: string;
}

const targetLabel = (t: AlertTarget) => `${t.display_name} - ${t.email}`;

export default function AdminAlerts({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  const [targetText, setTargetText] = useState('');
  const [targets, setTargets] = useState<AlertTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    apiFetch<{ users: AlertTarget[] }>('/admin/alert-targets')
      .then((body) => setTargets(body.users))
      .catch((err) => console.error('Loading alert targets failed', err));
  }, []);

  async function handleSubmit(values: AlertFormValues) {
    setError(null);
    setSent(false);
    const target = targets.find((t) => targetLabel(t) === targetText.trim());
    if (!target) {
      setError('Pick a user from the suggestions.');
      return;
    }
    try {
      await apiFetch(`/admin/users/${target.id}/alerts`, { method: 'POST', body: JSON.stringify(values) });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <AppShell active="alerts" user={user} refresh={refresh} contentClassName="m3-page">
      <h1 className="m3-headline">Send alert</h1>
      <section>
        {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
        {sent && <p className="m3-banner" role="status">Alert sent.</p>}
        <div className="m3-card">
          <h2 className="m3-card__title">Recipient</h2>
          <label className="m3-field">
            Target User
            <Autocomplete
              value={targetText}
              onChange={(value) => { setTargetText(value); setSent(false); }}
              options={targets.map((t) => ({ id: t.id, value: targetLabel(t), label: t.display_name, detail: t.email }))}
              placeholder="Name or email"
              required
            />
          </label>
        </div>
        <div className="m3-card">
          <h2 className="m3-card__title">Message</h2>
          <AlertEditor visibilityOptions={['dashboard']} submitLabel="Send alert" onSubmit={handleSubmit} />
        </div>
      </section>
    </AppShell>
  );
}
