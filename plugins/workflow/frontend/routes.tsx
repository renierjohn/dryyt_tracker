import type { PluginRoute } from '../../sdk';
import WorkflowAdminPage from './pages/WorkflowAdminPage';
import PublicWorkflowPage from './pages/PublicWorkflowPage';
import ScanPickupPage from './pages/ScanPickupPage';

const routes: PluginRoute[] = [
  // Any signed-in user: owners (manage_users) get the admin view, everyone
  // else a read-only list of the transactions registered for them.
  { path: '/plugins/workflow', element: <WorkflowAdminPage />, alias: '/transactions' },
  // Owner-only pickup scanner (linked from AppShell's nav in place of My Track).
  { path: '/plugins/workflow/scan', element: <ScanPickupPage />, requiredPermission: 'manage_users' },
  // Reached from an owner's card on the homepage (src/components/OwnersList.tsx,
  // via the /owner/:identifier alias) — read-only, no auth, distinct from the
  // owner's own /plugins/workflow above. identifier is the owner's id or
  // display_name (see worker/db.ts's getActiveOwnerByIdentifier).
  { path: '/plugins/workflow/:identifier', element: <PublicWorkflowPage />, public: true, alias: '/owner/:identifier' },
];

export default routes;
