import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser } from '../lib/useCurrentUser';
import { isOwner } from '../lib/permissions';
import ProfileSettings, { AlertsPanel } from './ProfileSettings';
import LogoutButton from '../components/LogoutButton';
import PluginNav from '../components/PluginNav';
import PluginSlot from '../components/PluginSlot';
import OwnerUsers from '../components/OwnerUsers';
import '../assets/sass/dashboard.scss';

type DashboardTab = 'users' | 'alerts' | 'profile';

export default function Dashboard({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  const showUsersTab = isOwner(user);
  const [tab, setTab] = useState<DashboardTab>(showUsersTab ? 'users' : 'alerts');

  return (
    <div className="dashboard">
      <nav className="dashboard__tabs">
        {showUsersTab && (
          <button
            type="button"
            className={`dashboard__tab${tab === 'users' ? ' dashboard__tab--active' : ''}`}
            onClick={() => setTab('users')}
          >
            Users
          </button>
        )}
        <button
          type="button"
          className={`dashboard__tab${tab === 'alerts' ? ' dashboard__tab--active' : ''}`}
          onClick={() => setTab('alerts')}
        >
          Alerts
        </button>
        <button
          type="button"
          className={`dashboard__tab${tab === 'profile' ? ' dashboard__tab--active' : ''}`}
          onClick={() => setTab('profile')}
        >
          Profile
        </button>
      </nav>

      {tab === 'users' && showUsersTab && <OwnerUsers />}
      {tab === 'alerts' && <AlertsPanel user={user} />}
      {tab === 'profile' && <ProfileSettings user={user} refresh={refresh} />}

      <PluginSlot name="dashboard.footer" user={user} />
      <PluginNav
        user={user}
        leading={<Link className="tab" to="/">Home</Link>}
        trailing={<LogoutButton refresh={refresh} className="tab tab--primary" />}
      />
    </div>
  );
}
