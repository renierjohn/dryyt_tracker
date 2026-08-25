import type { AuthUser } from '../lib/useCurrentUser';
import ProfileSettings from './ProfileSettings';
import LogoutButton from '../components/LogoutButton';
import '../assets/sass/dashboard.scss';

export default function Dashboard({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  return (
    <div className="dashboard">
      <LogoutButton refresh={refresh} className="dashboard__button" />
      <ProfileSettings user={user} refresh={refresh} />
    </div>
  );
}
