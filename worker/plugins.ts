// The one manual registration point for plugin backends. Workers bundle statically
// (esbuild via wrangler), so there's no runtime filesystem discovery here the way
// Vite's import.meta.glob gives the frontend — each plugin gets one import + one
// entry below. The mount path is derived from the plugin's own manifest.id (not
// hand-typed) so it can't drift out of sync with the frontend's API calls, and
// manifest.enabled is checked here the same way the frontend checks it in
// src/plugins/loadPlugins.ts — one flag, both sides respect it.
import type { Hono } from 'hono';
import type { AppBindings } from './types';
import type { PluginManifest } from '../plugins/types';
import helloManifest from '../plugins/hello/manifest';
import helloRoutes from '../plugins/hello/backend/routes';

const registrations: { manifest: PluginManifest; router: Hono<AppBindings> }[] = [
  { manifest: helloManifest, router: helloRoutes },
];

export const pluginRouters: { path: string; router: Hono<AppBindings> }[] = registrations
  .filter(({ manifest }) => manifest.enabled !== false)
  .map(({ manifest, router }) => ({ path: `/api/plugins/${manifest.id}`, router }));
