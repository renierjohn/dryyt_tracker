import { defineConfig } from 'vitest/config';
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
          // override it here rather than in the committed config.
          bindings: { TEST_MIGRATIONS: migrations, DEV_MODE: 'true' },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup/apply-migrations.ts'],
    },
  };
});
