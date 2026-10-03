import type { DbRole, DbUser } from './db';
import type { AuthUser } from './types';

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function toPublicUser(user: DbUser, role: DbRole): AuthUser {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role_id: user.role_id,
    role_name: role.name,
    permissions: JSON.parse(role.permissions) as string[],
    avatar_key: user.avatar_key,
    parent_id: user.parent_id,
  };
}
