import { Hono } from 'hono';
import { getUserById, getPublicAlertsForUser, listActiveOwners, getActiveOwnerByIdentifier } from '../db';
import { parseOpeningHours } from '../store';
import type { AppBindings } from '../types';

export const publicRoutes = new Hono<AppBindings>();

// Public directory of owners for the homepage — no auth required, so only
// display_name/email/contact_number/address/avatar_key go out, never anything else on the user row.
publicRoutes.get('/owners', async (c) => {
  const owners = await listActiveOwners(c.env.DB);
  return c.json({
    owners: owners.map((o) => ({
      id: o.id,
      display_name: o.display_name,
      email: o.email,
      contact_number: o.contact_number,
      address: o.address,
      avatar_key: o.avatar_key,
    })),
  });
});

// An owner's public store details, contact info and public alerts (visibility
// 'public' or 'both'; body_html is sanitized on write), for their
// /owner/:identifier page.
publicRoutes.get('/owners/:identifier/store', async (c) => {
  const owner = await getActiveOwnerByIdentifier(c.env.DB, c.req.param('identifier'));
  if (!owner) return c.json({ error: 'not_found' }, 404);
  return c.json({
    store: {
      address: owner.address,
      lat: owner.lat,
      lng: owner.lng,
      opening_hours: parseOpeningHours(owner.opening_hours),
    },
    contact: { email: owner.email, contact_number: owner.contact_number },
    avatar_key: owner.avatar_key,
    alerts: (await getPublicAlertsForUser(c.env.DB, owner.id)).map((a) => ({
      id: a.id,
      type: a.type,
      body_html: a.body_html,
    })),
  });
});

publicRoutes.get('/users/:id/public', async (c) => {
  const id = Number(c.req.param('id'));
  const user = await getUserById(c.env.DB, id);
  if (!user || !user.is_active) return c.json({ error: 'not_found' }, 404);

  const alerts = await getPublicAlertsForUser(c.env.DB, id);
  return c.json({ display_name: user.display_name, avatar_key: user.avatar_key, alerts });
});
