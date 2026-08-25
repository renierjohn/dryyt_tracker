import { Link } from 'react-router-dom';
import type { AuthUser } from '../lib/useCurrentUser';
import ProfileSettings from './ProfileSettings';
import '../assets/sass/dashboard.scss';

export default function Dashboard({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  return (
    <div className="dashboard">
      <Link className="back-link" to="/">← Home</Link>
      <ProfileSettings user={user} refresh={refresh} />
    </div>
  );
}
