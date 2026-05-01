import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAdmin } from './auth';
import { listAdmins, addAdmin, removeAdmin } from '../lib/admins';

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.get('/', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);
  const addresses = await listAdmins(c.env);
  return c.json({ addresses });
});

adminRoutes.post('/', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);
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
  try {
    const addresses = await removeAdmin(c.env, c.req.param('address'), admin);
    return c.json({ addresses });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'remove failed' }, 400);
  }
});
