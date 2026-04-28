import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAdmin } from './auth';

export const fileRoutes = new Hono<{ Bindings: Env }>();

const MAX_COVER_BYTES = 4 * 1024 * 1024; // 4 MB
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

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

// Admin cover-image upload. Content-Type drives the stored MIME and extension.
fileRoutes.post('/cover', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);

  const ct = (c.req.header('Content-Type') || '').toLowerCase().split(';')[0].trim();
  if (!ALLOWED_IMAGE_TYPES.includes(ct)) {
    return c.json({ error: 'unsupported image type', allowed: ALLOWED_IMAGE_TYPES }, 415);
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: 'empty body' }, 400);
  if (body.byteLength > MAX_COVER_BYTES) {
    return c.json({ error: `cover too large (max ${MAX_COVER_BYTES} bytes)` }, 413);
  }

  const ext = ct.split('/')[1] || 'bin';
  const digest = await crypto.subtle.digest('SHA-256', body);
  const hash = bytesToHex(digest).slice(0, 32);
  const key = `covers/${hash}.${ext}`;

  await c.env.STORAGE.put(key, body, { httpMetadata: { contentType: ct } });

  const origin = new URL(c.req.url).origin;
  return c.json({ key, url: `${origin}/file/${key}` });
});
