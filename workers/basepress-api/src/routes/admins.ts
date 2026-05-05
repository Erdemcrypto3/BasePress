import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAdmin } from './auth';
import { listAdmins, addAdmin, removeAdmin, isSuperAdmin } from '../lib/admins';
// P001-PAI-0039: per-session rate limiting on write endpoints
import { checkRateLimit, getClientIp } from '../lib/rate-limit';

export const adminRoutes = new Hono<{ Bindings: Env }>();

// P001-PAI-0039: strict rate limit — admin mutations are high-impact
const RATE_LIMIT_ADMIN_WRITE = 5; // max 5 add/remove per 60 s

adminRoutes.get('/', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);
  const addresses = await listAdmins(c.env);
  return c.json({ addresses });
});

adminRoutes.post('/', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);

  // P001-PAI-0052: only super-admins can add/remove admins
  if (!isSuperAdmin(c.env, admin)) {
    return c.json({ error: 'super-admin required for admin changes' }, 403);
  }

  // P001-PAI-0039: per-session rate limit on admin add
  const ip = getClientIp(c);
  if (!(await checkRateLimit(c.env.SESSIONS, 'admin-write', `${admin}:${ip}`, RATE_LIMIT_ADMIN_WRITE))) {
    return c.json({ error: 'rate limit exceeded, try again later' }, 429);
  }

  const { address } = await c.req.json<{ address: string }>();
  if (!address) return c.json({ error: 'address required' }, 400);
  try {
    const addresses = await addAdmin(c.env, address, admin);
    return c.json({ addresses });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'add failed' }, 400);
  }
});

adminRoutes.delete('/:address', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);

  // P001-PAI-0052: only super-admins can add/remove admins
  if (!isSuperAdmin(c.env, admin)) {
    return c.json({ error: 'super-admin required for admin changes' }, 403);
  }

  // P001-PAI-0039: per-session rate limit on admin remove
  const ip = getClientIp(c);
  if (!(await checkRateLimit(c.env.SESSIONS, 'admin-write', `${admin}:${ip}`, RATE_LIMIT_ADMIN_WRITE))) {
    return c.json({ error: 'rate limit exceeded, try again later' }, 429);
  }

  try {
    const addresses = await removeAdmin(c.env, c.req.param('address'), admin);
    return c.json({ addresses });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'remove failed' }, 400);
  }
});
