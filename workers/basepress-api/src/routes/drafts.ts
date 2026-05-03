import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAdmin } from './auth';
import { listAllKeys } from '../lib/kv-helpers';

export const draftRoutes = new Hono<{ Bindings: Env }>();

const MAX_DRAFTS_PER_AUTHOR = 50;
const MAX_BODY_BYTES = 512_000;

type StoredDraft = {
  draftId: string;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  priceEth: string;
  maxSupply: string;
  coverImage?: string;
  body: string;
  selectedChains: number[];
  createdAt: number;
  updatedAt: number;
};

function draftKey(address: string, draftId: string): string {
  return `draft:${address}:${draftId}`;
}

function draftPrefix(address: string): string {
  return `draft:${address}:`;
}

draftRoutes.get('/', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);

  // P001-PAI-0032: use cursor-based pagination to fetch all draft keys
  const allKeys = await listAllKeys(c.env.DRAFTS, { prefix: draftPrefix(admin) });
  const drafts: StoredDraft[] = [];
  for (const k of allKeys) {
    const raw = await c.env.DRAFTS.get(k.name);
    if (raw) drafts.push(JSON.parse(raw));
  }
  drafts.sort((a, b) => b.updatedAt - a.updatedAt);
  return c.json({ drafts });
});

draftRoutes.get('/:draftId', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);

  const raw = await c.env.DRAFTS.get(draftKey(admin, c.req.param('draftId')));
  if (!raw) return c.json({ error: 'not found' }, 404);
  return c.json(JSON.parse(raw));
});

draftRoutes.put('/:draftId', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);

  const draftId = c.req.param('draftId');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(draftId)) {
    return c.json({ error: 'invalid draftId' }, 400);
  }

  const payload = await c.req.json<Omit<StoredDraft, 'draftId' | 'createdAt' | 'updatedAt'>>();
  if (typeof payload.body === 'string' && new TextEncoder().encode(payload.body).length > MAX_BODY_BYTES) {
    return c.json({ error: 'body too large' }, 413);
  }

  const key = draftKey(admin, draftId);
  const existing = await c.env.DRAFTS.get(key);
  const now = Math.floor(Date.now() / 1000);

  if (!existing) {
    // P001-PAI-0032: use cursor-based pagination for accurate quota check
    const quotaKeys = await listAllKeys(c.env.DRAFTS, { prefix: draftPrefix(admin) });
    if (quotaKeys.length >= MAX_DRAFTS_PER_AUTHOR) {
      return c.json({ error: `draft quota reached (max ${MAX_DRAFTS_PER_AUTHOR})` }, 429);
    }
  }

  const prev = existing ? (JSON.parse(existing) as StoredDraft) : null;
  const draft: StoredDraft = {
    draftId,
    slug: payload.slug ?? '',
    title: payload.title ?? '',
    description: payload.description ?? '',
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 5) : [],
    priceEth: payload.priceEth ?? '0.001',
    maxSupply: payload.maxSupply ?? '0',
    coverImage: payload.coverImage,
    body: payload.body ?? '',
    selectedChains: Array.isArray(payload.selectedChains) ? payload.selectedChains : [],
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };

  await c.env.DRAFTS.put(key, JSON.stringify(draft));
  return c.json({ ok: true, draft });
});

draftRoutes.delete('/:draftId', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);

  const key = draftKey(admin, c.req.param('draftId'));
  const existing = await c.env.DRAFTS.get(key);
  if (!existing) return c.json({ error: 'not found' }, 404);

  await c.env.DRAFTS.delete(key);
  return c.json({ ok: true });
});
