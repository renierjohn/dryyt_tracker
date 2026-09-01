import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AuthUser } from '../lib/useCurrentUser';
import { isSuperadmin } from '../lib/permissions';
import LogoutButton from '../components/LogoutButton';
import PluginNav from '../components/PluginNav';
import '../assets/sass/home.scss';

export default function Home({ user, refresh }: { user: AuthUser | null; refresh: () => Promise<void> }) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  function handleTrack(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    navigate(`/track?code=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="home">
      {user ? (
        <>
          <h1>Welcome, {user.display_name}</h1>
          <p>Role: {user.role_name}</p>
          <LogoutButton refresh={refresh} className="home__button" />
        </>
      ) : (
        <h1>Track your order</h1>
      )}

      <form className="home__track-form" onSubmit={handleTrack}>
        <label>
          Order code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. 7K4PXM"
            maxLength={6}
            required
          />
        </label>
        <button type="submit">Track</button>
      </form>

      {user ? (
        <>
          <p>
            <Link to={isSuperadmin(user) ? '/admin' : '/dashboard'}>
              Go to {isSuperadmin(user) ? 'admin console' : 'dashboard'}
            </Link>
          </p>
          <PluginNav user={user} />
        </>
      ) : (
        <p>
          <Link to="/login">Log in</Link> or <Link to="/register">Register</Link>
        </p>
      )}
    </div>
  );
}
