import type { DbRole, DbUser } from './db';
import type { AuthUser } from './types';

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Digits plus common phone punctuation; 7–15 digits covers local and E.164 numbers.
export function isValidContactNumber(value: string): boolean {
  if (!/^\+?[\d\s().-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
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
    contact_number: user.contact_number,
  };
}
