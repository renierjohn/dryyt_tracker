import type { PluginSlotProps } from '../../../sdk';

export default function DashboardFooterWidget({ user }: PluginSlotProps) {
  return (
    <p style={{ textAlign: 'center', color: 'var(--text)' }}>
      Hello, {user.display_name} — this line was injected into the dashboard by the
      hello plugin's <code>dashboard.footer</code> slot, not hardcoded into Dashboard.tsx.
    </p>
  );
}
