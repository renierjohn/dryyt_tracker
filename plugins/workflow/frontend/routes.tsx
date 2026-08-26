import type { PluginRoute } from '../../sdk';
import WorkflowAdminPage from './pages/WorkflowAdminPage';

const routes: PluginRoute[] = [
  { path: '/plugins/workflow', element: <WorkflowAdminPage />, requiredPermission: 'manage_users' },
];

export default routes;
