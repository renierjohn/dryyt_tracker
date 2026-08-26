import type { PluginManifest } from '../types';

const manifest: PluginManifest = {
  id: 'workflow',
  navLabel: 'Workflow',
  navPath: '/plugins/workflow',
  requiredPermission: 'manage_users',
};

export default manifest;
