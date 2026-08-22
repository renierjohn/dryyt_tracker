export interface Env {
  DB: D1Database;
  AVATARS: R2Bucket;
  DEV_MODE?: 'true' | 'false';
}

export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  role_id: number;
  role_name: string;
  permissions: string[];
  avatar_key: string | null;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { user: AuthUser | null };
};
