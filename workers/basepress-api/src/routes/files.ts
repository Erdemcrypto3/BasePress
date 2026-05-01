import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAdmin } from './auth';

export const fileRoutes = new Hono<{ Bindings: Env }>();

const MAX_COVER_BYTES = 4 * 1024 * 1024; // 4 MB
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// PAI-0021: explicit prefix allowlist — only article bodies and covers are
// publicly readable; never serve other R2 paths even if the bucket grows.
const PUBLIC_PREFIXES = ['articles/', 'covers/'];

// Public R2 reader — serves article bodies and cover images.
// No auth: content is meant to be read by anyone.
fileRoutes.get('/*', async (c) => {
  const key = c.req.path.replace(/^\/file\//, '');
  if (!key) return c.json({ error: 'missing key' }, 400);
  if (!PUBLIC_PREFIXES.some((p) => key.startsWith(p))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const obj = await c.env.STORAGE.get(key);
  if (!obj) return c.json({ error: 'not found' }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=300');
  return new Response(obj.body, { headers });
});

// PAI-0012: magic byte signatures per image type
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF header
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],  // GIF8
};

function matchesMagicBytes(data: ArrayBuffer, contentType: string): boolean {
  const signatures = MAGIC_BYTES[contentType];
  if (!signatures) return false;
  const bytes = new Uint8Array(data);
  return signatures.some((sig) =>
    sig.every((b, i) => i < bytes.length && bytes[i] === b),
  );
}

// PAI-0029: decode-light validation — read each format's header to extract
// dimensions. If we can't parse them, the file is malformed past the magic
// bytes (decode-bomb / fuzzer payload). Workers can't run a full decoder so
// header-level parsing is the cheapest shape check we can do.
const MAX_IMAGE_DIMENSION = 8192;
const MAX_IMAGE_PIXELS = 25_000_000; // 25 MP

type Dimensions = { width: number; height: number };

function readDimensions(data: ArrayBuffer, contentType: string): Dimensions | null {
  const v = new DataView(data);
  const u = new Uint8Array(data);
  try {
    if (contentType === 'image/png' && u.length >= 24) {
      // PNG IHDR follows the 8-byte signature; width/height are big-endian uint32 at offset 16/20.
      return { width: v.getUint32(16, false), height: v.getUint32(20, false) };
    }
    if (contentType === 'image/gif' && u.length >= 10) {
      // Logical screen descriptor: width/height little-endian uint16 at offset 6/8.
      return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
    }
    if (contentType === 'image/jpeg') {
      // Scan for SOF0/1/2/3 markers: 0xFFC0..0xFFC3 (skip C4=DHT, C8=JPG, CC=DAC).
      let i = 2; // past 0xFFD8 SOI
      while (i + 8 < u.length) {
        if (u[i] !== 0xff) break;
        const marker = u[i + 1];
        const segLen = (u[i + 2] << 8) | u[i + 3];
        if (marker >= 0xc0 && marker <= 0xc3) {
          // SOF: precision(1) | height(2) | width(2)
          const height = (u[i + 5] << 8) | u[i + 6];
          const width = (u[i + 7] << 8) | u[i + 8];
          return { width, height };
        }
        i += 2 + segLen;
      }
      return null;
    }
    if (contentType === 'image/webp' && u.length >= 30) {
      // VP8X (extended), VP8L (lossless), VP8 (lossy) chunks at offset 12.
      const chunk = String.fromCharCode(u[12], u[13], u[14], u[15]);
      if (chunk === 'VP8X') {
        // 24-bit little-endian width-1, height-1 at 24/27.
        const width = 1 + (u[24] | (u[25] << 8) | (u[26] << 16));
        const height = 1 + (u[27] | (u[28] << 8) | (u[29] << 16));
        return { width, height };
      }
      if (chunk === 'VP8L' && u.length >= 25) {
        const b1 = u[21], b2 = u[22], b3 = u[23], b4 = u[24];
        const width = 1 + (((b2 & 0x3f) << 8) | b1);
        const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6));
        return { width, height };
      }
      if (chunk === 'VP8 ' && u.length >= 30) {
        const width = ((u[27] << 8) | u[26]) & 0x3fff;
        const height = ((u[29] << 8) | u[28]) & 0x3fff;
        return { width, height };
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

fileRoutes.post('/cover', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
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

  if (!matchesMagicBytes(body, ct)) {
    return c.json({ error: 'file content does not match declared Content-Type' }, 415);
  }

  // PAI-0029: header-level decode validation — reject malformed past magic bytes
  // and reject implausibly large dimensions (decode-bomb mitigation).
  const dims = readDimensions(body, ct);
  if (!dims) {
    return c.json({ error: 'image header could not be decoded' }, 415);
  }
  if (
    dims.width <= 0 || dims.height <= 0 ||
    dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION ||
    dims.width * dims.height > MAX_IMAGE_PIXELS
  ) {
    return c.json(
      { error: `image dimensions out of bounds (max ${MAX_IMAGE_DIMENSION}px, ${MAX_IMAGE_PIXELS / 1_000_000}MP)` },
      413,
    );
  }

  const ext = ct.split('/')[1] || 'bin';
  const digest = await crypto.subtle.digest('SHA-256', body);
  const hash = bytesToHex(digest).slice(0, 32);
  const key = `covers/${hash}.${ext}`;

  await c.env.STORAGE.put(key, body, { httpMetadata: { contentType: ct } });

  const origin = new URL(c.req.url).origin;
  return c.json({ key, url: `${origin}/file/${key}` });
});
