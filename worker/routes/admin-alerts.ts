import { Hono } from 'hono';
import { sanitizeHtml } from '../sanitize';
import { createAlert, getUserById } from '../db';
import type { DbAlert } from '../db';
import { requireRole } from '../middleware/auth';
import type { AppBindings } from '../types';

// Split out of admin.ts (which is superadmin-only) so the 'admin' role can inject
// alerts without gaining access to the rest of the console (user create/edit/
// deactivate/masquerade, all still superadmin-only).
export const adminAlertsRoutes = new Hono<AppBindings>();

adminAlertsRoutes.use('*', requireRole('admin', 'superadmin'));

const ALERT_TYPES = new Set(['info', 'success', 'warning', 'danger']);
const ALERT_VISIBILITIES = new Set(['dashboard', 'public', 'both']);

adminAlertsRoutes.post('/users/:id/alerts', async (c) => {
  const admin = c.get('user')!;
  const targetUserId = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  const type = typeof body?.type === 'string' ? body.type : '';
  const visibility = typeof body?.visibility === 'string' ? body.visibility : 'public';
  const bodyHtml = typeof body?.body_html === 'string' ? body.body_html : '';

  if (!ALERT_TYPES.has(type)) return c.json({ error: 'invalid_type' }, 400);
  if (!ALERT_VISIBILITIES.has(visibility)) return c.json({ error: 'invalid_visibility' }, 400);
  if (!bodyHtml.trim()) return c.json({ error: 'missing_body' }, 400);

  const targetUser = await getUserById(c.env.DB, targetUserId);
  if (!targetUser) return c.json({ error: 'not_found' }, 404);

  const sanitized = await sanitizeHtml(bodyHtml);
  const alert = await createAlert(c.env.DB, {
    userId: targetUserId,
    createdBy: admin.id,
    type: type as DbAlert['type'],
    visibility: visibility as DbAlert['visibility'],
    bodyHtml: sanitized,
  });
  return c.json({ alert }, 201);
});
