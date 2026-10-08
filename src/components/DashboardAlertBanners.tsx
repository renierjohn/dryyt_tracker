import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { AlertFormValues } from './AlertEditor';
import '../assets/sass/dashboard-alert-banner.scss';

interface DashboardAlert {
  id: number;
  type: AlertFormValues['type'];
  visibility: AlertFormValues['visibility'];
  body_html: string;
  updated_at: string;
}

// Dismissals are per browser, keyed by id + updated_at so an edited alert shows again.
const DISMISSED_KEY = 'dryyt.dismissedAlerts';
const dismissKey = (a: DashboardAlert) => `${a.id}:${a.updated_at}`;

function readDismissed(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

// The signed-in user's dashboard-visible alerts, shown full width above the
// page like the masquerade banner. Body HTML is sanitized server-side.
export default function DashboardAlertBanners() {
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);

  useEffect(() => {
    apiFetch<{ alerts: DashboardAlert[] }>('/alerts')
      .then((body) => {
        const dismissed = new Set(readDismissed());
        // Drop dismissals for alerts that no longer exist or were edited.
        const current = new Set(body.alerts.map(dismissKey));
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed].filter((k) => current.has(k))));
        setAlerts(
          body.alerts.filter(
            (a) => a.visibility === 'dashboard' && !dismissed.has(dismissKey(a)),
          ),
        );
      })
      .catch((err) => console.error('Loading dashboard alerts failed', err));
  }, []);

  function dismiss(alert: DashboardAlert) {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...readDismissed(), dismissKey(alert)]));
    setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
  }

  if (alerts.length === 0) return null;
  return (
    <div className="dashboard-alert-banners">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`dashboard-alert-banner dashboard-alert-banner--${alert.type}`}
          role={alert.type === 'danger' || alert.type === 'warning' ? 'alert' : 'status'}
        >
          <div className="dashboard-alert-banner__body" dangerouslySetInnerHTML={{ __html: alert.body_html }} />
          <button type="button" className="dashboard-alert-banner__close" aria-label="Dismiss alert" onClick={() => dismiss(alert)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
