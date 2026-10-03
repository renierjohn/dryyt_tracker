// Shared surface for plugin *frontend* code — the one file plugin pages/routes
// should reach out of the plugins/ tree through, instead of importing src/lib/*
// directly. Backend code (including manifest.ts, which the worker also reads)
// should import types from ./types instead — that file has no runtime deps on
// browser-only code like apiFetch.
export * from './types';
export * from './slots';
export { apiFetch, ApiError } from '../src/lib/api';
export { useCurrentUser } from '../src/lib/useCurrentUser';
export { hasPermission } from '../src/lib/permissions';
