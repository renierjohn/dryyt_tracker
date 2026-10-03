import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuthUser } from '../lib/useCurrentUser';
import AppShell, { Icon } from '../components/AppShell';
import OwnersList from '../components/OwnersList';
import '../assets/sass/home.scss';

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
    <AppShell
      active="home"
      user={user}
      refresh={refresh}
      contentClassName="home__content"
    >
      <h1 className="home__headline">
        {user ? `Hi, ${user.display_name.split(/\s+/)[0]}` : 'Welcome Dryyt Tracker'}
      </h1>

      <form className="home__track-card" onSubmit={handleTrack}>
        <h2 className="home__card-title">Track now</h2>
        <div className="home__track-row">
          <div className="home__field">
            <input
              id="track-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder=" "
              maxLength={6}
              autoComplete="off"
              required
            />
            <label htmlFor="track-code">Code</label>
          </div>
          <button type="submit" className="home__fab" aria-label="Track">
            <Icon name="arrow" />
          </button>
        </div>
        <p className="home__supporting">6-character code, e.g. 7K4PXM</p>
      </form>

      <OwnersList />
    </AppShell>
  );
}
