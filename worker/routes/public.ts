import { Hono } from 'hono';
import { getUserById, getPublicAlertsForUser, listActiveOwners } from '../db';
import type { AppBindings } from '../types';

export const publicRoutes = new Hono<AppBindings>();

// Public directory of owners for the homepage — no auth required, so only
// display_name/email go out, never anything else on the user row.
publicRoutes.get('/owners', async (c) => {
  const owners = await listActiveOwners(c.env.DB);
  return c.json({ owners: owners.map((o) => ({ id: o.id, display_name: o.display_name, email: o.email })) });
});

publicRoutes.get('/users/:id/public', async (c) => {
  const id = Number(c.req.param('id'));
  const user = await getUserById(c.env.DB, id);
  if (!user || !user.is_active) return c.json({ error: 'not_found' }, 404);

  const alerts = await getPublicAlertsForUser(c.env.DB, id);
  return c.json({ display_name: user.display_name, avatar_key: user.avatar_key, alerts });
});
