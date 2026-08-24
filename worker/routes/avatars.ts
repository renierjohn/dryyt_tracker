import { Hono } from 'hono';
import type { AppBindings } from '../types';

export const avatarRoutes = new Hono<AppBindings>();

avatarRoutes.get('/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.AVATARS.get(key);
  if (!object) return c.json({ error: 'not_found' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});
