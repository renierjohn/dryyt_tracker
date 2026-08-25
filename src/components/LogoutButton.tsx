import { apiFetch } from '../lib/api';

export default function LogoutButton({ refresh, className }: { refresh: () => Promise<void>; className?: string }) {
  async function handleLogout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout request failed', err);
    }
    await refresh();
  }

  return <button className={className} onClick={handleLogout}>Log out</button>;
}
