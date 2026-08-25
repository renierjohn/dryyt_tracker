// Shared types (and re-exported app helpers) for plugin frontend code. This is the
// one file plugin code should reach out of the plugins/ tree through — keeps the
// "how do I call the app" surface centralized instead of every plugin page reaching
// into src/lib/* directly.
import type { ReactNode } from 'react';

export { apiFetch, ApiError } from '../src/lib/api';

export interface PluginRoute {
  path: string;
  element: ReactNode;
  // Omit for "any authenticated user"; App.tsx checks this the same way it checks
  // manage_users for /admin (via permissions.includes('*') || includes(requiredPermission)).
  requiredPermission?: string;
}

export interface PluginManifest {
  id: string;
  navLabel: string;
  navPath: string;
  requiredPermission?: string;
}
