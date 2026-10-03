import type { PluginRoute } from '../../sdk';
import ThemePage from './pages/ThemePage';

const routes: PluginRoute[] = [
  { path: '/plugins/theme', element: <ThemePage /> },
];

export default routes;
