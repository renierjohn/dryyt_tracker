import { Link } from 'react-router-dom';
import type { AuthUser } from '../lib/useCurrentUser';
import { apiFetch } from '../lib/api';
import { hasManageUsers } from '../lib/permissions';
import '../assets/sass/home.scss';

export default function Home({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  async function handleLogout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout request failed', err);
    }
    await refresh();
  }

  const admin = hasManageUsers(user);

  return (
    <div className="home">
      <h1>Welcome, {user.display_name}</h1>
      <p>Role: {user.role_name}</p>
      <button className="home__button" onClick={handleLogout}>Log out</button>
      <p>
        <Link to={admin ? '/admin' : '/dashboard'}>Go to {admin ? 'admin console' : 'dashboard'}</Link>
      </p>
    </div>
  );
}
