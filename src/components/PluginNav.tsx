import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser } from '../lib/useCurrentUser';
import { hasPermission } from '../lib/permissions';
import { pluginManifests } from '../plugins/loadPlugins';

export default function PluginNav({
  user,
  leading,
  trailing,
}: {
  user: AuthUser;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const visible = pluginManifests.filter((m) => !m.requiredPermission || hasPermission(user, m.requiredPermission));
  if (visible.length === 0 && !leading && !trailing) return null;

  return (
    <nav className="tab-bar">
      {leading}
      {visible.map((m) => (
        <Link className="tab" to={m.navPath} key={m.id}>{m.navLabel}</Link>
      ))}
      {trailing}
    </nav>
  );
}
