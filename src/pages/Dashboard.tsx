import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser } from '../lib/useCurrentUser';
import { isCustomer, isOwner, hasPermission } from '../lib/permissions';
import { pluginManifests } from '../plugins/loadPlugins';
import ProfileSettings, { AlertsPanel } from './ProfileSettings';
import AppShell, { Icon } from '../components/AppShell';
import PluginSlot from '../components/PluginSlot';
import OwnerUsers from '../components/OwnerUsers';
import StoreSettings from '../components/StoreSettings';
import DashboardAlertBanners from '../components/DashboardAlertBanners';
import '../assets/sass/dashboard.scss';

type DashboardTab = 'users' | 'store' | 'alerts' | 'profile';

export default function Dashboard({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  const showUsersTab = isOwner(user);
  // Customers ('user' role) get their dashboard alerts as banners only.
  const showAlertsTab = !isCustomer(user);
  const [tab, setTab] = useState<DashboardTab>(showUsersTab ? 'users' : showAlertsTab ? 'alerts' : 'profile');
  const tabs: { key: DashboardTab; label: string }[] = [
    ...(showUsersTab
      ? [
          { key: 'users' as const, label: 'Users' },
          { key: 'store' as const, label: 'Store' },
        ]
      : []),
    ...(showAlertsTab ? [{ key: 'alerts' as const, label: 'Alerts' }] : []),
    { key: 'profile', label: 'Profile' },
  ];
  const shortcuts = pluginManifests.filter((m) => !m.requiredPermission || hasPermission(user, m.requiredPermission));

  return (
    <>
      <DashboardAlertBanners />
      <AppShell active="dashboard" user={user} refresh={refresh} contentClassName="dashboard dashboard__content">
        <h1 className="dashboard__headline">Dashboard</h1>

        <div className="dashboard__main">
          <div className="dashboard__tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`dashboard__tab${tab === t.key ? ' dashboard__tab--active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'users' && showUsersTab && <OwnerUsers />}
          {tab === 'store' && showUsersTab && <StoreSettings ownerName={user.display_name} />}
          {tab === 'alerts' && showAlertsTab && <AlertsPanel user={user} />}
          {tab === 'profile' && <ProfileSettings user={user} refresh={refresh} />}

          <PluginSlot name="dashboard.footer" user={user} />
        </div>

        {shortcuts.length > 0 && (
          <section className="dashboard__shortcuts">
            <h2 className="dashboard__section-title">Shortcuts</h2>
            <ul className="dashboard__shortcut-list">
              {shortcuts.map((m) => (
                <li key={m.id}>
                  <Link className="dashboard__shortcut" to={m.navPath}>
                    <span className="dashboard__shortcut-icon" aria-hidden="true">{m.navLabel.charAt(0).toUpperCase()}</span>
                    <span className="dashboard__shortcut-label">{m.navLabel}</span>
                    <Icon name="arrow" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </AppShell>
    </>
  );
}
