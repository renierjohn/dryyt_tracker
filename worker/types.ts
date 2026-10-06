export interface Env {
  DB: D1Database;
  AVATARS: R2Bucket;
  DEV_MODE?: 'true' | 'false';
  TURNSTILE_SECRET_KEY?: string;
}

export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  role_id: number;
  role_name: string;
  permissions: string[];
  avatar_key: string | null;
  parent_id: number | null;
  contact_number: string | null;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { user: AuthUser | null; impersonatorId: number | null };
};
