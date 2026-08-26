import { Hono } from 'hono';
import { requireAuth } from '../../../worker/middleware/auth';
import type { AppBindings } from '../../../worker/types';

const helloRoutes = new Hono<AppBindings>();

helloRoutes.use('*', requireAuth);

// Upserts a per-user visit counter (see plugins/hello/migrations/0001_init.sql) to
// prove a plugin can own its own table and still go through the app's own auth
// middleware/db binding, same as a core route would.
helloRoutes.post('/ping', async (c) => {
  const userId = c.get('user')!.id;
  await c.env.DB
    .prepare(
      `INSERT INTO hello_plugin_visits (user_id, count) VALUES (?, 1)
       ON CONFLICT(user_id) DO UPDATE SET count = count + 1`,
    )
    .bind(userId)
    .run();
  const row = await c.env.DB
    .prepare('SELECT count FROM hello_plugin_visits WHERE user_id = ?')
    .bind(userId)
    .first<{ count: number }>();
  return c.json({ count: row?.count ?? 0 });
});

export default helloRoutes;
