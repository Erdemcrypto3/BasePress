// P001-PAI-0039: shared per-session / per-IP rate limiting for write endpoints.
// Extracted from auth.ts (PAI-0011/0018) so every mutating route can reuse it.

/**
 * Extract the client's real IP from Cloudflare headers.
 */
export function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown'
  );
}

/**
 * Sliding-window rate limiter backed by KV.
 *
 * @param kv        KV namespace (usually SESSIONS)
 * @param endpoint  logical name — kept short to minimise key size
 * @param identity  session token, admin address, or IP
 * @param max       max requests inside `windowSec`
 * @param windowSec sliding window duration (default 60 s)
 * @returns `true` if the request is allowed, `false` if rate-limited
 */
export async function checkRateLimit(
  kv: KVNamespace,
  endpoint: string,
  identity: string,
  max: number,
  windowSec = 60,
): Promise<boolean> {
  const key = `ratelimit:${endpoint}:${identity}`;
  const raw = await kv.get(key);
  const now = Math.floor(Date.now() / 1000);

  if (!raw) {
    await kv.put(key, JSON.stringify({ count: 1, start: now }), {
      expirationTtl: windowSec,
    });
    return true;
  }

  const data = JSON.parse(raw) as { count: number; start: number };
  if (data.count >= max) return false;

  data.count++;
  const remaining = windowSec - (now - data.start);
  await kv.put(key, JSON.stringify(data), {
    expirationTtl: Math.max(remaining, 1),
  });
  return true;
}

/**
 * Daily counter (resets at midnight UTC). Used for cover-upload quota.
 *
 * @returns `true` if under the daily cap, `false` if exceeded
 */
export async function checkDailyLimit(
  kv: KVNamespace,
  endpoint: string,
  identity: string,
  maxPerDay: number,
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `dailylimit:${endpoint}:${identity}:${today}`;
  const raw = await kv.get(key);

  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= maxPerDay) return false;

  // TTL = seconds until end of UTC day (max 86 400)
  const nowSec = Math.floor(Date.now() / 1000);
  const midnightSec = Math.ceil(nowSec / 86400) * 86400;
  const ttl = Math.max(midnightSec - nowSec, 1);

  await kv.put(key, String(count + 1), { expirationTtl: ttl });
  return true;
}
