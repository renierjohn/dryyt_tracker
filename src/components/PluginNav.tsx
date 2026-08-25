import { Link } from 'react-router-dom';
import type { AuthUser } from '../lib/useCurrentUser';
import { hasPermission } from '../lib/permissions';
import { pluginManifests } from '../plugins/loadPlugins';

export default function PluginNav({ user }: { user: AuthUser }) {
  const visible = pluginManifests.filter((m) => !m.requiredPermission || hasPermission(user, m.requiredPermission));
  if (visible.length === 0) return null;

  return (
    <nav className="plugin-nav">
      <h2>Plugins</h2>
      <ul>
        {visible.map((m) => (
          <li key={m.id}>
            <Link to={m.navPath}>{m.navLabel}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
