// Pure types only, no runtime imports beyond React's own type declarations — this
// is what worker/plugins.ts (and any other backend code) imports a manifest's
// shape from. sdk.ts re-exports these for frontend code, but also pulls in
// apiFetch/ApiError (real runtime code backed by browser fetch), which must never
// end up in anything the worker's tsconfig/bundle touches.
import type { ReactNode } from 'react';

export interface PluginRoute {
  path: string;
  element: ReactNode;
  // Omit for "any authenticated user"; App.tsx checks this the same way it checks
  // manage_users for /admin (via permissions.includes('*') || includes(requiredPermission)).
  requiredPermission?: string;
  // An additional URL that renders the same element as `path` (not a redirect) —
  // e.g. a short vanity path like /transactions for /plugins/workflow. Subject to
  // the same requiredPermission gate as the canonical path.
  alias?: string;
}

export interface PluginManifest {
  id: string;
  navLabel: string;
  navPath: string;
  requiredPermission?: string;
  // Default true. Set false to take the plugin out of both the frontend (nav +
  // routes, via src/plugins/loadPlugins.ts) and the backend (worker/plugins.ts
  // reads this same manifest before mounting the router) from one place.
  enabled?: boolean;
}
