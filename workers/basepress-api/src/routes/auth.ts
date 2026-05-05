import { Hono } from 'hono';
import { SiweMessage } from 'siwe';
import type { Env } from '../index';
import { isAdmin as kvIsAdmin } from '../lib/admins';
// P001-PAI-0039: use shared rate-limit helpers (extracted from this file)
import { checkRateLimit, getClientIp } from '../lib/rate-limit';

export const authRoutes = new Hono<{ Bindings: Env }>();

// P001-PAI-0058: whitelist of supported chain IDs for SIWE messages
const SUPPORTED_CHAIN_IDS = [8453, 57073] as const; // Base, Ink

const NONCE_TTL_SECONDS = 300;
const SESSION_TTL_SECONDS = 3600;
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

authRoutes.post('/nonce', async (c) => {
  const ip = getClientIp(c);
  if (!(await checkRateLimit(c.env.SESSIONS, 'nonce', ip, RATE_LIMIT_MAX_REQUESTS_NONCE))) {
    return c.json({ error: 'rate limit exceeded, try again later' }, 429);
  }

  const { address, chainId } = await c.req.json<{ address: string; chainId?: number }>();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return c.json({ error: 'bad address' }, 400);

  // P001-PAI-0058: accept client chainId with whitelist validation, default to Base
  const resolvedChainId = chainId && SUPPORTED_CHAIN_IDS.includes(chainId as (typeof SUPPORTED_CHAIN_IDS)[number])
    ? chainId
    : 8453;

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
    chainId: resolvedChainId,
    nonce,
    issuedAt: new Date().toISOString(),
  }).prepareMessage();

  return c.json({ nonce, message });
});

authRoutes.post('/verify', async (c) => {
  const ip = getClientIp(c);
  if (!(await checkRateLimit(c.env.SESSIONS, 'verify', ip, RATE_LIMIT_MAX_REQUESTS_VERIFY))) {
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

// P001-PAI-0033: server-side session invalidation on sign-out
authRoutes.post('/logout', async (c) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ ok: true }); // no token — nothing to revoke
  }
  const token = authHeader.slice(7);
  await c.env.SESSIONS.delete(`session:${token}`);
  return c.json({ ok: true });
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
