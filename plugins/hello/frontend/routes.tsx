// Route config, not a component module — lazy() page consts are fine here.
/* eslint-disable react-refresh/only-export-components */
import { lazy } from 'react';
import type { PluginRoute } from '../../sdk';
const HelloPage = lazy(() => import('./pages/HelloPage'));

const routes: PluginRoute[] = [
  { path: '/plugins/hello', element: <HelloPage /> },
];

export default routes;
