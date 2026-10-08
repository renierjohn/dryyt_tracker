import { Hono } from 'hono';
import {
  createUser,
  deleteSessionsForUser,
  getUserByEmail,
  getUserById,
  getRoleByName,
  isOwnerCustomer,
  pageOwnerCustomers,
  setUserActive,
  unlinkSharedCustomer,
  updateCoordinates,
  updateStoreDetails,
  updateUserProfile,
} from '../db';
import { parseOpeningHours, validateStoreDetails } from '../store';
import { requireRole } from '../middleware/auth';
import { parsePage, PAGE_SIZE } from '../pagination';
import { hashPassword } from '../crypto';
import { isValidContactNumber, isValidEmail } from '../util';
import type { AppBindings } from '../types';

// Self-service: an 'owner' role user creates and lists their own customer
// accounts (always role 'user', linked via owner_customers), separate from the
// superadmin-only /admin/users console.
export const ownerRoutes = new Hono<AppBindings>();

ownerRoutes.use('*', requireRole('owner'));

// Paginated: ?page=.
ownerRoutes.get('/users', async (c) => {
  const owner = c.get('user')!;
  const { page, limit, offset } = parsePage(c.req.query('page'));
  const { users, total } = await pageOwnerCustomers(c.env.DB, owner.id, { limit, offset });
  return c.json({
    page,
    page_size: PAGE_SIZE,
    total,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      contact_number: u.contact_number,
      is_active: u.is_active,
      created_at: u.created_at,
    })),
  });
});

// One of the owner's own customers (including ones shared with other owners),
// or null — owners can't touch anyone else.
async function getOwnChild(db: D1Database, ownerId: number, id: number) {
  if (!(await isOwnerCustomer(db, ownerId, id))) return null;
  return getUserById(db, id);
}

ownerRoutes.put('/users/:id', async (c) => {
  const owner = c.get('user')!;
  const target = await getOwnChild(c.env.DB, owner.id, Number(c.req.param('id')));
  if (!target) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;
  // Optional: an empty string clears it.
  const contactNumber =
    typeof body?.contact_number === 'string' ? body.contact_number.trim() || null : undefined;
  const isActive = typeof body?.is_active === 'boolean' ? body.is_active : undefined;

  if (displayName !== undefined && !displayName) return c.json({ error: 'missing_display_name' }, 400);
  if (contactNumber && !isValidContactNumber(contactNumber)) return c.json({ error: 'invalid_contact_number' }, 400);
  if (email !== undefined) {
    if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);
    const existing = await getUserByEmail(c.env.DB, email);
    if (existing && existing.id !== target.id) return c.json({ error: 'email_taken' }, 409);
  }

  let updated;
  try {
    updated = await updateUserProfile(c.env.DB, target.id, { displayName, email, contactNumber });
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) return c.json({ error: 'email_taken' }, 409);
    throw err;
  }
  if (isActive !== undefined && isActive !== Boolean(updated.is_active)) {
    await setUserActive(c.env.DB, target.id, isActive);
    if (!isActive) await deleteSessionsForUser(c.env.DB, target.id);
  }
  return c.json({
    user: {
      id: updated.id,
      email: updated.email,
      display_name: updated.display_name,
      contact_number: updated.contact_number,
      is_active: isActive === undefined ? updated.is_active : Number(isActive),
      created_at: updated.created_at,
    },
  });
});

// "Delete" removes the customer from this owner. A customer shared with other
// owners just loses this link; otherwise it deactivates — the row (and link)
// stays so sessions/alerts/transactions history keep their references, but the
// user can no longer sign in.
ownerRoutes.delete('/users/:id', async (c) => {
  const owner = c.get('user')!;
  const target = await getOwnChild(c.env.DB, owner.id, Number(c.req.param('id')));
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (await unlinkSharedCustomer(c.env.DB, owner.id, target.id)) return c.json({ ok: true });
  await setUserActive(c.env.DB, target.id, false);
  await deleteSessionsForUser(c.env.DB, target.id);
  return c.json({ ok: true });
});

ownerRoutes.post('/users', async (c) => {
  const owner = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : '';
  const contactNumber = typeof body?.contact_number === 'string' ? body.contact_number.trim() || null : null;

  if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);
  if (contactNumber && !isValidContactNumber(contactNumber)) return c.json({ error: 'invalid_contact_number' }, 400);
  if (password.length < 8) return c.json({ error: 'weak_password' }, 400);
  if (!displayName) return c.json({ error: 'missing_display_name' }, 400);
  if (await getUserByEmail(c.env.DB, email)) return c.json({ error: 'email_taken' }, 409);

  const userRole = await getRoleByName(c.env.DB, 'user');
  if (!userRole) return c.json({ error: 'role_not_configured' }, 500);

  const { hash, salt } = await hashPassword(password);
  let user;
  try {
    user = await createUser(c.env.DB, {
      email,
      passwordHash: hash,
      passwordSalt: salt,
      roleId: userRole.id,
      displayName,
      parentId: owner.id,
      contactNumber,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) return c.json({ error: 'email_taken' }, 409);
    throw err;
  }
  return c.json(
    {
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        contact_number: user.contact_number,
        is_active: user.is_active,
        created_at: user.created_at,
      },
    },
    201,
  );
});

export default ownerRoutes;

// The owner's own store details (address + map pin + opening hours), shown
// publicly on their store page — see publicRoutes' /owners/:identifier/store.
ownerRoutes.get('/store', async (c) => {
  const owner = (await getUserById(c.env.DB, c.get('user')!.id))!;
  return c.json({
    store: {
      address: owner.address,
      lat: owner.lat,
      lng: owner.lng,
      opening_hours: parseOpeningHours(owner.opening_hours),
    },
  });
});

ownerRoutes.put('/store', async (c) => {
  const owner = c.get('user')!;
  const details = validateStoreDetails(await c.req.json().catch(() => null));
  if ('error' in details) return c.json({ error: details.error }, 400);
  await updateStoreDetails(c.env.DB, owner.id, {
    address: details.address,
    lat: details.lat,
    lng: details.lng,
    openingHours: details.opening_hours ? JSON.stringify(details.opening_hours) : null,
  });
  return c.json({ store: details });
});

// Just the store's map coordinates (Profile tab → "Your coordinates"). Both
// null clears them.
ownerRoutes.put('/coordinates', async (c) => {
  const body = await c.req.json().catch(() => null);
  const lat = body?.lat ?? null;
  const lng = body?.lng ?? null;
  if (lat !== null || lng !== null) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return c.json({ error: 'invalid_location' }, 400);
    if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) return c.json({ error: 'invalid_location' }, 400);
  }
  await updateCoordinates(c.env.DB, c.get('user')!.id, lat, lng);
  return c.json({ lat, lng });
});
