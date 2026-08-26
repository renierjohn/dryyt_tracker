import type { AuthUser } from './useCurrentUser';

export function hasPermission(user: AuthUser, permission: string): boolean {
  return user.permissions.includes('*') || user.permissions.includes(permission);
}

export function hasManageUsers(user: AuthUser): boolean {
  return hasPermission(user, 'manage_users');
}
