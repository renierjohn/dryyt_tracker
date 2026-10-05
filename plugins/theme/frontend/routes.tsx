// Route config, not a component module — lazy() page consts are fine here.
/* eslint-disable react-refresh/only-export-components */
import { lazy } from 'react';
import type { PluginRoute } from '../../sdk';
const ThemePage = lazy(() => import('./pages/ThemePage'));

const routes: PluginRoute[] = [
  { path: '/plugins/theme', element: <ThemePage /> },
];

export default routes;
