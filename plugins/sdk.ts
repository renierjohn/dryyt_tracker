// Shared surface for plugin *frontend* code — the one file plugin pages/routes
// should reach out of the plugins/ tree through, instead of importing src/lib/*
// directly. Backend code (including manifest.ts, which the worker also reads)
// should import types from ./types instead — that file has no runtime deps on
// browser-only code like apiFetch.
export * from './types';
export * from './slots';
export { apiFetch, ApiError } from '../src/lib/api';
export { useCurrentUser, type AuthUser } from '../src/lib/useCurrentUser';
export { useSession } from '../src/lib/session';
export { default as AppShell, Icon, type IconName } from '../src/components/AppShell';
export { hasPermission } from '../src/lib/permissions';
export { RichTextEditor, StoreInfo } from '../src/components/LazyHeavy';
export type { RichTextEditorInstance } from '../src/components/RichTextEditor';
export { default as RichText } from '../src/components/RichText';
export { CONTACT_ERROR, isInvalidContact } from '../src/lib/contact';
export { useColorbox } from '../src/lib/useColorbox';
export type { StoreDetails } from '../src/lib/store';
