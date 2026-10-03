import type { PluginSlotEntry } from '../../sdk';
import ThemeApplier from './components/ThemeApplier';

const slots: PluginSlotEntry[] = [
  { slot: 'app.root', component: ThemeApplier },
];

export default slots;
