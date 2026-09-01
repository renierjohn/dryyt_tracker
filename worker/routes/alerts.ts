import { Hono } from 'hono';
import { sanitizeHtml } from '../sanitize';
import { createAlert, getAlertsForUser, getAlertById, updateAlert, deleteAlert } from '../db';
import type { DbAlert } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import type { AppBindings, AuthUser } from '../types';

export const alertRoutes = new Hono<AppBindings>();

alertRoutes.use('*', requireAuth);

const ALERT_TYPES = new Set(['info', 'success', 'warning', 'danger']);
const ALERT_VISIBILITIES = new Set(['dashboard', 'public', 'both']);

function canManageAlert(user: AuthUser, alert: DbAlert): boolean {
  if (alert.user_id === user.id) return true;
  return user.id === 1 || user.permissions.includes('*') || user.permissions.includes('manage_users');
}

alertRoutes.get('/', async (c) => {
  const user = c.get('user')!;
  const alerts = await getAlertsForUser(c.env.DB, user.id);
  return c.json({ alerts });
});

alertRoutes.post('/', requireRole('admin', 'superadmin'), async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const type = typeof body?.type === 'string' ? body.type : '';
  const visibility = typeof body?.visibility === 'string' ? body.visibility : 'public';
  const bodyHtml = typeof body?.body_html === 'string' ? body.body_html : '';

  if (!ALERT_TYPES.has(type)) return c.json({ error: 'invalid_type' }, 400);
  if (!ALERT_VISIBILITIES.has(visibility)) return c.json({ error: 'invalid_visibility' }, 400);
  if (!bodyHtml.trim()) return c.json({ error: 'missing_body' }, 400);

  const sanitized = await sanitizeHtml(bodyHtml);
  const alert = await createAlert(c.env.DB, {
    userId: user.id,
    createdBy: user.id,
    type: type as DbAlert['type'],
    visibility: visibility as DbAlert['visibility'],
    bodyHtml: sanitized,
  });
  return c.json({ alert }, 201);
});

alertRoutes.put('/:id', async (c) => {
  const user = c.get('user')!;
  const id = Number(c.req.param('id'));
  const alert = await getAlertById(c.env.DB, id);
  if (!alert) return c.json({ error: 'not_found' }, 404);
  if (!canManageAlert(user, alert)) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json().catch(() => null);
  const type = typeof body?.type === 'string' ? body.type : alert.type;
  const visibility = typeof body?.visibility === 'string' ? body.visibility : alert.visibility;
  const bodyHtml = typeof body?.body_html === 'string' ? body.body_html : alert.body_html;

  if (!ALERT_TYPES.has(type)) return c.json({ error: 'invalid_type' }, 400);
  if (!ALERT_VISIBILITIES.has(visibility)) return c.json({ error: 'invalid_visibility' }, 400);

  const sanitized = await sanitizeHtml(bodyHtml);
  const updated = await updateAlert(c.env.DB, id, {
    type: type as DbAlert['type'],
    visibility: visibility as DbAlert['visibility'],
    bodyHtml: sanitized,
  });
  return c.json({ alert: updated });
});

alertRoutes.delete('/:id', async (c) => {
  const user = c.get('user')!;
  const id = Number(c.req.param('id'));
  const alert = await getAlertById(c.env.DB, id);
  if (!alert) return c.json({ error: 'not_found' }, 404);
  if (!canManageAlert(user, alert)) return c.json({ error: 'forbidden' }, 403);

  await deleteAlert(c.env.DB, id);
  return c.body(null, 204);
});
