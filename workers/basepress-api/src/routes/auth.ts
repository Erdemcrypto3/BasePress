import { Hono } from 'hono';
import { SiweMessage } from 'siwe';
import type { Env } from '../index';

export const authRoutes = new Hono<{ Bindings: Env }>();

const NONCE_TTL_SECONDS = 300; // 5 min
const SESSION_TTL_SECONDS = 300; // 5 min — admin re-signs frequently, intentional

function isAdminAddress(env: Env, address: string): boolean {
  return env.ADMIN_ADDRESSES.toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .includes(address.toLowerCase());
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

authRoutes.post('/nonce', async (c) => {
  const { address } = await c.req.json<{ address: string }>();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return c.json({ error: 'bad address' }, 400);

  const nonce = randomNonce();
  await c.env.SESSIONS.put(`nonce:${nonce}`, address.toLowerCase(), {
    expirationTtl: NONCE_TTL_SECONDS,
  });

  // SIWE message template — frontend reconstructs an identical message and
  // signs it. Domain + URI must match the frontend origin.
  const origin = new URL(c.env.ALLOWED_ORIGIN);
  const message = new SiweMessage({
    domain: origin.host,
    address,
    statement: 'Sign in to BasePress admin.',
    uri: c.env.ALLOWED_ORIGIN,
    version: '1',
    chainId: 8453, // Base by default; verify accepts any signed chainId
    nonce,
    issuedAt: new Date().toISOString(),
  }).prepareMessage();

  return c.json({ nonce, message });
});

authRoutes.post('/verify', async (c) => {
  const { message, signature } = await c.req.json<{ message: string; signature: string }>();
  if (!message || !signature) return c.json({ error: 'missing fields' }, 400);

  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(message);
  } catch {
    return c.json({ error: 'malformed message' }, 400);
  }

  const verification = await siwe.verify({ signature });
  if (!verification.success) return c.json({ error: 'signature invalid' }, 401);

  const address = verification.data.address.toLowerCase();
  if (!isAdminAddress(c.env, address)) return c.json({ error: 'not admin' }, 403);

  // Burn the nonce so a leaked SIWE message can't be replayed.
  const nonce = verification.data.nonce;
  const stored = await c.env.SESSIONS.get(`nonce:${nonce}`);
  if (stored !== address) return c.json({ error: 'nonce invalid or already used' }, 401);
  await c.env.SESSIONS.delete(`nonce:${nonce}`);

  const token = randomNonce() + randomNonce();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await c.env.SESSIONS.put(`session:${token}`, address, { expirationTtl: SESSION_TTL_SECONDS });

  return c.json({ token, address, expiresAt });
});

export async function requireAdmin(env: Env, authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const address = await env.SESSIONS.get(`session:${token}`);
  if (!address) return null;
  return isAdminAddress(env, address) ? address : null;
}
