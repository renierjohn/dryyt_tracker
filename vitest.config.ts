import { configDefaults, defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import path from 'node:path';

export default defineConfig(async () => {
  const migrationsPath = path.join(import.meta.dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // wrangler.jsonc's top-level DEV_MODE is "false" (the production-safe
          // default). Tests need the forgot-password dev-mode behavior, so
          // override it here rather than in the committed config. Turnstile's
          // secret is blanked (it would otherwise come from .dev.vars) so auth
          // requests skip siteverify, as DEV_MODE allows.
          bindings: { TEST_MIGRATIONS: migrations, DEV_MODE: 'true', TURNSTILE_SECRET_KEY: '' },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup/apply-migrations.ts'],
      // .claude/worktrees/** and .worktrees/** are git-ignored but not excluded
      // from vitest's own file discovery, so any nested worktree's test/
      // directory gets picked up too, double-running (or worse) the whole
      // suite. Exclude them explicitly alongside vitest's own defaults
      // (node_modules, dist, etc).
      exclude: [...configDefaults.exclude, '.claude/**', '.worktrees/**'],
    },
  };
});
