export interface Env {
  DB: D1Database;
}

export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  role_id: number;
  role_name: string;
  permissions: string[];
}

export type AppBindings = {
  Bindings: Env;
  Variables: { user: AuthUser | null };
};
