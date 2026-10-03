import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AuthUser } from '../lib/useCurrentUser';
import { isSuperadmin, canSendAlerts } from '../lib/permissions';
import LogoutButton from '../components/LogoutButton';
import OwnersList from '../components/OwnersList';
import '../assets/sass/home.scss';

// The bottom bar is built directly here (not via <PluginNav>) because it needs
// one flat row mixing core links (dashboard, alerts) with the auth action —
// plugin links (Workflow, Theme) are deliberately left off; they stay reachable
// from Dashboard's own <PluginNav> instead.

export default function Home({ user, refresh }: { user: AuthUser | null; refresh: () => Promise<void> }) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  // The homepage always renders in the default/global theme, regardless of the
  // signed-in user's own flavor (set elsewhere by the theme plugin's ThemeApplier)
  // or a previously-viewed owner's flavor (set by PublicWorkflowPage).
  useEffect(() => {
    document.documentElement.dataset.theme = 'default';
  }, []);

  function handleTrack(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    navigate(`/track?code=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="home">
      <header className="home__header">
        <span className="home__brand">dryyt</span>
        {user && <span className="home__user">{user.display_name}</span>}
      </header>

      <h1>Track Now</h1>

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

      <OwnersList />

      <nav className="tab-bar">
        {user && (
          <Link className="tab" to={isSuperadmin(user) ? '/admin' : '/dashboard'}>
            {isSuperadmin(user) ? 'Admin' : 'Dashboard'}
          </Link>
        )}
        {user && !isSuperadmin(user) && canSendAlerts(user) && (
          <Link className="tab" to="/admin/alerts">Send alert</Link>
        )}
        {!user && <Link className="tab" to="/register">Register</Link>}
        {user ? (
          <LogoutButton refresh={refresh} className="tab tab--primary" />
        ) : (
          <Link className="tab tab--primary" to="/login">Log in</Link>
        )}
      </nav>
    </div>
  );
}
