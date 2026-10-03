import type { PluginManifest } from '../types';

// Pure data, no runtime deps — lives here (rather than a plugin-root flavors.ts)
// because manifest.ts is the one plugin file both tsconfig.worker.json
// (plugins/*/backend + plugins/*/manifest.ts) and tsconfig.app.json
// (plugins/*/frontend + plugins/*/manifest.ts) include, so backend and frontend
// code can both import it without a third, uncovered include path.
export const FLAVORS = ['default', 'ocean', 'sunset', 'forest', 'midnight'] as const;
export type Flavor = (typeof FLAVORS)[number];
export const FLAVOR_LABELS: Record<Flavor, string> = {
  default: 'Default',
  ocean: 'Ocean',
  sunset: 'Sunset',
  forest: 'Forest',
  midnight: 'Midnight',
};

const manifest: PluginManifest = {
  id: 'theme',
  navLabel: 'Theme',
  navPath: '/plugins/theme',
};

export default manifest;
