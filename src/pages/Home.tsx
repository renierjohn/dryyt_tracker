import { Link } from 'react-router-dom';
import type { AuthUser } from '../lib/useCurrentUser';
import { hasManageUsers } from '../lib/permissions';
import LogoutButton from '../components/LogoutButton';
import '../assets/sass/home.scss';

export default function Home({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  const admin = hasManageUsers(user);

  return (
    <div className="home">
      <h1>Welcome, {user.display_name}</h1>
      <p>Role: {user.role_name}</p>
      <LogoutButton refresh={refresh} className="home__button" />
      <p>
        <Link to={admin ? '/admin' : '/dashboard'}>Go to {admin ? 'admin console' : 'dashboard'}</Link>
      </p>
    </div>
  );
}
