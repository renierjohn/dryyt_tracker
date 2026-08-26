import type { PluginRoute } from '../../sdk';
import HelloPage from './pages/HelloPage';

const routes: PluginRoute[] = [
  { path: '/plugins/hello', element: <HelloPage /> },
];

export default routes;
