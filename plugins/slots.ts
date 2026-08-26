// Slot types are frontend-only (no backend involvement in "render this component
// at this point in a page"), so this file is intentionally NOT part of
// tsconfig.worker.json's include — safe to reach into src/lib/* the same way
// sdk.ts does for apiFetch/ApiError.
import type { ComponentType } from 'react';
import type { AuthUser } from '../src/lib/useCurrentUser';

export interface PluginSlotProps {
  user: AuthUser;
}

export interface PluginSlotEntry {
  // Host pages declare slot names they expose (e.g. "dashboard.footer") via
  // <PluginSlot name="..." user={user} /> — see src/components/PluginSlot.tsx.
  slot: string;
  component: ComponentType<PluginSlotProps>;
  requiredPermission?: string;
}
