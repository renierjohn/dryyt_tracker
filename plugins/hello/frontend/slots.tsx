import type { PluginSlotEntry } from '../../sdk';
import DashboardFooterWidget from './components/DashboardFooterWidget';

const slots: PluginSlotEntry[] = [
  { slot: 'dashboard.footer', component: DashboardFooterWidget },
];

export default slots;
