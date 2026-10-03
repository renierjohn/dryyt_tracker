import { Hono } from 'hono';
import { requireAuth, requireRole } from '../../../worker/middleware/auth';
import { getActiveOwnerByIdentifier } from '../../../worker/db';
import type { AppBindings } from '../../../worker/types';
import { FLAVORS, type Flavor } from '../manifest';

// Mixed auth (the public owner-lookup below sits alongside the session-based
// /me endpoints), so middleware is applied per-route rather than once via
// `.use('*', ...)` — same reasoning as plugins/workflow/backend/routes.ts.
const themeRoutes = new Hono<AppBindings>();

// Public: lets an anonymous visitor on a given owner's public workflow page
// (see plugins/workflow's /owners/:identifier/transactions) render in that
// owner's chosen flavor. identifier is either the owner's id or display_name
// — see getActiveOwnerByIdentifier. A nonexistent/non-owner identifier just
// falls back to 'default', same as /me does internally.
themeRoutes.get('/owners/:identifier', async (c) => {
  const owner = await getActiveOwnerByIdentifier(c.env.DB, c.req.param('identifier'));
  if (!owner) return c.json({ flavor: 'default' });

  const row = await c.env.DB
    .prepare('SELECT flavor FROM theme_preferences WHERE owner_id = ?')
    .bind(owner.id)
    .first<{ flavor: string }>();
  return c.json({ flavor: row?.flavor ?? 'default' });
});

// Effective flavor resolution: an 'owner' account has its own row; a 'user'
// account (created under an owner — see plugins/owner... /api/owner/users)
// inherits its parent's row. Anyone else (admin/superadmin, or a 'user' with
// no parent) isn't part of an owner hierarchy and just gets 'default'.
themeRoutes.get('/me', requireAuth, async (c) => {
  const user = c.get('user')!;
  const isOwner = user.role_name === 'owner';
  const ownerId = isOwner ? user.id : user.parent_id;

  let flavor: string = 'default';
  if (ownerId !== null) {
    const row = await c.env.DB
      .prepare('SELECT flavor FROM theme_preferences WHERE owner_id = ?')
      .bind(ownerId)
      .first<{ flavor: string }>();
    flavor = row?.flavor ?? 'default';
  }
  return c.json({ flavor, editable: isOwner });
});

themeRoutes.put('/me', requireRole('owner'), async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const flavor = typeof body?.flavor === 'string' ? body.flavor : '';

  if (!FLAVORS.includes(flavor as Flavor)) return c.json({ error: 'invalid_flavor' }, 400);

  await c.env.DB
    .prepare(
      `INSERT INTO theme_preferences (owner_id, flavor) VALUES (?, ?)
       ON CONFLICT(owner_id) DO UPDATE SET flavor = excluded.flavor, updated_at = datetime('now')`,
    )
    .bind(user.id, flavor)
    .run();
  return c.json({ flavor });
});

export default themeRoutes;
