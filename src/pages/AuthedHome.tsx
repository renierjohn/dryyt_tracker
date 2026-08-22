import type { AuthUser } from '../lib/useCurrentUser';
import { apiFetch } from '../lib/api';

export default function AuthedHome({ user, onLoggedOut }: { user: AuthUser; onLoggedOut: () => Promise<void> }) {
  async function handleLogout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout request failed', err);
    }
    await onLoggedOut();
  }

  return (
    <div>
      <h1>Welcome, {user.display_name}</h1>
      <p>Role: {user.role_name}</p>
      <button onClick={handleLogout}>Log out</button>
      <p>Dashboard, profile editing, and alerts are built in the next sub-project.</p>
    </div>
  );
}
