import { Hono } from 'hono';
import { SiweMessage } from 'siwe';
import type { Env } from '../index';
import { isAdmin as kvIsAdmin } from '../lib/admins';

export const authRoutes = new Hono<{ Bindings: Env }>();

const NONCE_TTL_SECONDS = 300;
const SESSION_TTL_SECONDS = 3600;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS_NONCE = 10;
const RATE_LIMIT_MAX_REQUESTS_VERIFY = 5;

// PAI-0030: KV-backed list with env bootstrap; see lib/admins.ts.
async function isAdminAddress(env: Env, address: string): Promise<boolean> {
  return kvIsAdmin(env, address);
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}

// PAI-0011 (nonce) + PAI-0018 (verify): rate-limit per (endpoint, IP) via KV
async function checkRateLimit(env: Env, endpoint: string, ip: string, max: number): Promise<boolean> {
  const key = `ratelimit:${endpoint}:${ip}`;
  const raw = await env.SESSIONS.get(key);
  const now = Math.floor(Date.now() / 1000);

  if (!raw) {
    await env.SESSIONS.put(key, JSON.stringify({ count: 1, start: now }), {
      expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
    });
    return true;
  }

  const data = JSON.parse(raw) as { count: number; start: number };
  if (data.count >= max) return false;

  data.count++;
  const remaining = RATE_LIMIT_WINDOW_SECONDS - (now - data.start);
  await env.SESSIONS.put(key, JSON.stringify(data), {
    expirationTtl: Math.max(remaining, 1),
  });
  return true;
}

authRoutes.post('/nonce', async (c) => {
  const ip = getClientIp(c);
  if (!(await checkRateLimit(c.env, 'nonce', ip, RATE_LIMIT_MAX_REQUESTS_NONCE))) {
    return c.json({ error: 'rate limit exceeded, try again later' }, 429);
  }

  const { address } = await c.req.json<{ address: string }>();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return c.json({ error: 'bad address' }, 400);

  const nonce = randomNonce();
  await c.env.SESSIONS.put(`nonce:${nonce}`, address.toLowerCase(), {
    expirationTtl: NONCE_TTL_SECONDS,
  });

  const origin = new URL(c.env.ALLOWED_ORIGIN);
  const message = new SiweMessage({
    domain: origin.host,
    address,
    statement: 'Sign in to BasePress admin.',
    uri: c.env.ALLOWED_ORIGIN,
    version: '1',
    chainId: 8453,
    nonce,
    issuedAt: new Date().toISOString(),
  }).prepareMessage();

  return c.json({ nonce, message });
});

authRoutes.post('/verify', async (c) => {
  const ip = getClientIp(c);
  if (!(await checkRateLimit(c.env, 'verify', ip, RATE_LIMIT_MAX_REQUESTS_VERIFY))) {
    return c.json({ error: 'rate limit exceeded, try again later' }, 429);
  }

  const { message, signature } = await c.req.json<{ message: string; signature: string }>();
  if (!message || !signature) return c.json({ error: 'missing fields' }, 400);

  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(message);
  } catch {
    return c.json({ error: 'malformed message' }, 400);
  }

  // PAI-0002: verify domain + URI match allowed origin
  const expectedOrigin = new URL(c.env.ALLOWED_ORIGIN);
  const verification = await siwe.verify({
    signature,
    domain: expectedOrigin.host,
    nonce: siwe.nonce,
  });
  if (!verification.success) return c.json({ error: 'signature invalid' }, 401);

  if (verification.data.uri !== c.env.ALLOWED_ORIGIN) {
    return c.json({ error: 'uri mismatch' }, 401);
  }

  const address = verification.data.address.toLowerCase();
  if (!(await isAdminAddress(c.env, address))) return c.json({ error: 'not admin' }, 403);

  const nonce = verification.data.nonce;
  const stored = await c.env.SESSIONS.get(`nonce:${nonce}`);
  if (stored !== address) return c.json({ error: 'nonce invalid or already used' }, 401);
  await c.env.SESSIONS.delete(`nonce:${nonce}`);

  // PAI-0004: bind session to origin so stolen tokens can't be used cross-origin
  const requestOrigin = c.req.header('origin') || '';
  const token = randomNonce() + randomNonce();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await c.env.SESSIONS.put(
    `session:${token}`,
    JSON.stringify({ address, origin: requestOrigin }),
    { expirationTtl: SESSION_TTL_SECONDS },
  );

  return c.json({ token, address, expiresAt });
});

// PAI-0004: requireAdmin checks that the request origin matches the session origin
export async function requireAdmin(
  env: Env,
  authHeader: string | undefined,
  requestOrigin?: string,
): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const raw = await env.SESSIONS.get(`session:${token}`);
  if (!raw) return null;

  // PAI-0023: fail closed on malformed session payload — no bare-string fallback
  let parsed: { address: string; origin?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.address !== 'string') return null;

  const { address, origin: boundOrigin } = parsed;
  if (boundOrigin && requestOrigin && boundOrigin !== requestOrigin) return null;
  return (await isAdminAddress(env, address)) ? address : null;
}
