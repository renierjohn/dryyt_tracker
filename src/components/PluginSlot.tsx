import type { AuthUser } from '../lib/useCurrentUser';
import { hasPermission } from '../lib/permissions';
import { pluginSlotEntries } from '../plugins/loadPlugins';

// Drop this anywhere in a core page to let plugins inject UI there — pick a
// dot-namespaced name (e.g. "dashboard.footer") and document it, then a plugin
// registers a component for that name in its own frontend/slots.tsx.
export default function PluginSlot({ name, user }: { name: string; user: AuthUser }) {
  const entries = pluginSlotEntries.filter(
    (entry) => entry.slot === name && (!entry.requiredPermission || hasPermission(user, entry.requiredPermission)),
  );

  return (
    <>
      {entries.map((entry, i) => {
        const Component = entry.component;
        return <Component key={i} user={user} />;
      })}
    </>
  );
}
