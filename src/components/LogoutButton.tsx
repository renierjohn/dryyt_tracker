import type { ReactNode } from 'react';
import { apiFetch } from '../lib/api';

export default function LogoutButton({
  refresh,
  className,
  children = 'Log out',
}: {
  refresh: () => Promise<void>;
  className?: string;
  children?: ReactNode;
}) {
  async function handleLogout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout request failed', err);
    }
    await refresh();
  }

  return <button className={className} onClick={handleLogout}>{children}</button>;
}
