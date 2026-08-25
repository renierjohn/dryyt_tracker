import type { AuthUser } from './useCurrentUser';

export function hasManageUsers(user: AuthUser): boolean {
  return user.permissions.includes('*') || user.permissions.includes('manage_users');
}
