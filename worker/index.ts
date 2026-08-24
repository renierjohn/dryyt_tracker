import { Hono } from 'hono';
import { loadSession } from './middleware/auth';
import { authRoutes } from './routes/auth';
import { profileRoutes } from './routes/profile';
import type { AppBindings } from './types';

const app = new Hono<AppBindings>();

app.use('*', loadSession);
app.route('/api/auth', authRoutes);
app.route('/api/profile', profileRoutes);

app.get('/api/health', (c) => c.json({ ok: true }));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
