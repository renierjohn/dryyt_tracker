import { createContext, useContext } from 'react';
import type { AuthUser } from './useCurrentUser';

// App.tsx's own session, shared with pages it doesn't render directly (plugin
// routes). Calling useCurrentUser() from such a page would start a second,
// independent session copy — logging out through it would leave App's copy
// (and so its route guards) still signed in.
export interface Session {
  user: AuthUser | null;
  refresh: () => Promise<void>;
}

export const SessionContext = createContext<Session>({ user: null, refresh: async () => {} });

export function useSession() {
  return useContext(SessionContext);
}
