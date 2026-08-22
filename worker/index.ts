import { Hono } from 'hono';
import type { AppBindings } from './types';

const app = new Hono<AppBindings>();

app.get('/api/health', (c) => c.json({ ok: true }));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
