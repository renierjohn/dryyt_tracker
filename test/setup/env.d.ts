import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Env as WorkerEnv } from '../../worker/types';

declare global {
  namespace Cloudflare {
    // The Worker's own bindings (so tests can hand `env` to its handlers),
    // plus the migrations vitest.config.ts injects.
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
