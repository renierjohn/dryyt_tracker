// The one manual registration point for plugin backends. Workers bundle statically
// (esbuild via wrangler), so there's no runtime filesystem discovery here the way
// Vite's import.meta.glob gives the frontend — each plugin gets one import + one
// entry below.
import type { Hono } from 'hono';
import type { AppBindings } from './types';
import helloRoutes from '../plugins/hello/backend/routes';

export const pluginRouters: { path: string; router: Hono<AppBindings> }[] = [
  { path: '/api/plugins/hello', router: helloRoutes },
];
