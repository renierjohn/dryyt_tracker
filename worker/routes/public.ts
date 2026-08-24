import { Hono } from 'hono';
import { getUserById, getPublicAlertsForUser } from '../db';
import type { AppBindings } from '../types';

export const publicRoutes = new Hono<AppBindings>();

publicRoutes.get('/users/:id/public', async (c) => {
  const id = Number(c.req.param('id'));
  const user = await getUserById(c.env.DB, id);
  if (!user || !user.is_active) return c.json({ error: 'not_found' }, 404);

  const alerts = await getPublicAlertsForUser(c.env.DB, id);
  return c.json({ display_name: user.display_name, avatar_key: user.avatar_key, alerts });
});
