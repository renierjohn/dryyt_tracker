import type { PluginRoute, PluginManifest, PluginSlotEntry } from '../../plugins/sdk';

// Patterns starting with "/" resolve relative to the project root (Vite glob
// semantics), which is where plugins/ lives — a sibling of src/, not inside it.
const routeModules = import.meta.glob<{ default: PluginRoute[] }>('/plugins/*/frontend/routes.tsx', {
  eager: true,
});
const manifestModules = import.meta.glob<{ default: PluginManifest }>('/plugins/*/manifest.ts', {
  eager: true,
});
// Optional — most plugins won't have one, and the glob simply matches nothing for those.
const slotModules = import.meta.glob<{ default: PluginSlotEntry[] }>('/plugins/*/frontend/slots.tsx', {
  eager: true,
});

// Glob keys look like "/plugins/hello/manifest.ts" — the folder name is what
// ties a routes.tsx/slots.tsx to its manifest.ts, regardless of the manifest's
// own `id`.
function pluginFolderFromPath(filePath: string): string {
  return filePath.split('/')[2];
}

const manifestsByFolder = new Map(
  Object.entries(manifestModules).map(([filePath, mod]) => [pluginFolderFromPath(filePath), mod.default]),
);

const enabledFolders = new Set(
  [...manifestsByFolder.entries()].filter(([, m]) => m.enabled !== false).map(([folder]) => folder),
);

export const pluginManifests: PluginManifest[] = [...manifestsByFolder.values()].filter((m) => m.enabled !== false);

// A plugin's routes/slots only load if its manifest is present and enabled — a
// plugin without a manifest isn't really registered, so neither stays reachable.
export const pluginRoutes: PluginRoute[] = Object.entries(routeModules)
  .filter(([filePath]) => enabledFolders.has(pluginFolderFromPath(filePath)))
  .flatMap(([, mod]) => mod.default);

export const pluginSlotEntries: PluginSlotEntry[] = Object.entries(slotModules)
  .filter(([filePath]) => enabledFolders.has(pluginFolderFromPath(filePath)))
  .flatMap(([, mod]) => mod.default);
