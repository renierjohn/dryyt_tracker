import type { PluginRoute, PluginManifest } from '../../plugins/sdk';

// Patterns starting with "/" resolve relative to the project root (Vite glob
// semantics), which is where plugins/ lives — a sibling of src/, not inside it.
const routeModules = import.meta.glob<{ default: PluginRoute[] }>('/plugins/*/frontend/routes.tsx', {
  eager: true,
});
const manifestModules = import.meta.glob<{ default: PluginManifest }>('/plugins/*/manifest.ts', {
  eager: true,
});

export const pluginRoutes: PluginRoute[] = Object.values(routeModules).flatMap((m) => m.default);
export const pluginManifests: PluginManifest[] = Object.values(manifestModules).map((m) => m.default);
