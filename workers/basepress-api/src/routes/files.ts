import { Hono } from 'hono';
import type { Env } from '../index';

export const fileRoutes = new Hono<{ Bindings: Env }>();

// Public R2 reader — serves article bodies and cover images.
// No auth: content is meant to be read by anyone.
fileRoutes.get('/*', async (c) => {
  const key = c.req.path.replace(/^\/file\//, '');
  if (!key) return c.json({ error: 'missing key' }, 400);

  const obj = await c.env.STORAGE.get(key);
  if (!obj) return c.json({ error: 'not found' }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=300');
  return new Response(obj.body, { headers });
});
