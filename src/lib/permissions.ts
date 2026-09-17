import type { AuthUser } from './useCurrentUser';

export function hasPermission(user: AuthUser, permission: string): boolean {
  return user.permissions.includes('*') || user.permissions.includes(permission);
}

// The admin console is gated on role identity, not on the manage_users permission
// (a role could be granted that permission for other purposes without becoming
// entitled to the console).
export function isSuperadmin(user: AuthUser): boolean {
  return user.role_name === 'superadmin';
}

// The alert-injection form is the one console feature the 'admin' role keeps
// access to (via /api/admin/users/:id/alerts, gated the same way server-side).
export function canSendAlerts(user: AuthUser): boolean {
  return user.role_name === 'admin' || user.role_name === 'owner' || user.role_name === 'superadmin';
}
