import { Hono } from 'hono';
import { loadSession } from './middleware/auth';
import { cacheControl } from './middleware/cache';
import { authRoutes } from './routes/auth';
import { profileRoutes } from './routes/profile';
import { avatarRoutes } from './routes/avatars';
import { alertRoutes } from './routes/alerts';
import { adminRoutes } from './routes/admin';
import { adminAlertsRoutes } from './routes/admin-alerts';
import { ownerRoutes } from './routes/owner';
import { publicRoutes } from './routes/public';
import { pluginRouters } from './plugins';
import type { AppBindings } from './types';

const app = new Hono<AppBindings>();

app.use('*', loadSession);
app.use('*', cacheControl);
app.route('/api/auth', authRoutes);
app.route('/api/profile', profileRoutes);
app.route('/api/avatars', avatarRoutes);
app.route('/api/alerts', alertRoutes);
app.route('/api/admin', adminAlertsRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/owner', ownerRoutes);
app.route('/api', publicRoutes);

for (const { path, router } of pluginRouters) {
  app.route(path, router);
}

app.get('/api/health', (c) => c.json({ ok: true }));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
