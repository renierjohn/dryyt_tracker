import type { PluginRoute } from '../../sdk';
import WorkflowAdminPage from './pages/WorkflowAdminPage';
import PublicWorkflowPage from './pages/PublicWorkflowPage';

const routes: PluginRoute[] = [
  { path: '/plugins/workflow', element: <WorkflowAdminPage />, requiredPermission: 'manage_users', alias: '/transactions' },
  // Reached from an owner's card on the homepage (src/components/OwnersList.tsx,
  // via the /owner/:identifier alias) — read-only, no auth, distinct from the
  // owner's own /plugins/workflow above. identifier is the owner's id or
  // display_name (see worker/db.ts's getActiveOwnerByIdentifier).
  { path: '/plugins/workflow/:identifier', element: <PublicWorkflowPage />, public: true, alias: '/owner/:identifier' },
];

export default routes;
