import { Hono } from 'hono';
import { hashPassword, generateToken } from '../crypto';
import { getUserByEmail, getUserById, updateUserProfile, updatePasswordHash, deleteSessionsForUser, setUserAvatarKey } from '../db';
import { requireAuth, createAndSetSession } from '../middleware/auth';
import { isValidEmail, isValidContactNumber, toPublicUser } from '../util';
import { getRoleById } from '../db';
import { detectImageMimeType } from '../image';
import type { AppBindings } from '../types';
import { parseSocialLinks, readSocialLinks } from '../socialLinks';

export const profileRoutes = new Hono<AppBindings>();

profileRoutes.use('*', requireAuth);

profileRoutes.get('/', async (c) => {
  const authUser = c.get('user')!;
  const user = await getUserById(c.env.DB, authUser.id);
  const role = await getRoleById(c.env.DB, user!.role_id);
  return c.json({ user: toPublicUser(user!, role!) });
});

profileRoutes.get('/social-links', async (c) => {
  const user = await getUserById(c.env.DB, c.get('user')!.id);
  return c.json({ social_links: readSocialLinks(user!.social_links ?? null) });
});

profileRoutes.put('/', async (c) => {
  const authUser = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;
  // Optional: an empty string clears it.
  const contactNumber =
    typeof body?.contact_number === 'string' ? body.contact_number.trim() || null : undefined;

  if (contactNumber && !isValidContactNumber(contactNumber)) {
    return c.json({ error: 'invalid_contact_number' }, 400);
  }
  // Optional: the full list, replacing what's stored; [] clears it.
  const socialLinks = body?.social_links === undefined ? undefined : parseSocialLinks(body.social_links);
  if (socialLinks === null) return c.json({ error: 'invalid_social_links' }, 400);

  if (email !== undefined) {
    if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);
    const existing = await getUserByEmail(c.env.DB, email);
    if (existing && existing.id !== authUser.id) {
      return c.json({ error: 'email_taken' }, 409);
    }
  }
  if (displayName !== undefined && !displayName) {
    return c.json({ error: 'missing_display_name' }, 400);
  }

  let updated;
  try {
    updated = await updateUserProfile(c.env.DB, authUser.id, {
      displayName,
      email,
      contactNumber,
      socialLinks: socialLinks === undefined ? undefined : socialLinks.length ? JSON.stringify(socialLinks) : null,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'email_taken' }, 409);
    }
    throw err;
  }
  const role = await getRoleById(c.env.DB, updated.role_id);
  return c.json({ user: toPublicUser(updated, role!), social_links: readSocialLinks(updated.social_links ?? null) });
});

profileRoutes.put('/password', async (c) => {
  const authUser = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const newPassword = typeof body?.new_password === 'string' ? body.new_password : '';

  if (newPassword.length < 8) return c.json({ error: 'weak_password' }, 400);

  const { hash, salt } = await hashPassword(newPassword);
  await updatePasswordHash(c.env.DB, authUser.id, hash, salt);
  await deleteSessionsForUser(c.env.DB, authUser.id);
  await createAndSetSession(c, authUser.id);

  return c.json({ ok: true });
});

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

profileRoutes.post('/avatar', async (c) => {
  const authUser = c.get('user')!;
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!(file instanceof File)) return c.json({ error: 'missing_file' }, 400);
  if (file.size > MAX_AVATAR_BYTES) return c.json({ error: 'file_too_large' }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType) return c.json({ error: 'unsupported_file_type' }, 400);

  const user = await getUserById(c.env.DB, authUser.id);
  const previousKey = user!.avatar_key;

  const key = `${authUser.id}-${generateToken()}.${EXTENSION_BY_MIME_TYPE[mimeType]}`;
  await c.env.AVATARS.put(key, bytes, { httpMetadata: { contentType: mimeType } });
  await setUserAvatarKey(c.env.DB, authUser.id, key);

  if (previousKey) {
    await c.env.AVATARS.delete(previousKey);
  }

  return c.json({ avatar_key: key });
});
