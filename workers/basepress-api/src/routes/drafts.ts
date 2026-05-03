import { Hono } from 'hono';
import sanitizeHtml from 'sanitize-html';
import {
  ALLOWED_TAGS,
  ALLOWED_ATTRIBUTES,
  ALLOWED_SCHEMES,
  ALLOWED_STYLES,
} from '@basepress/sanitizer';
import type { Env } from '../index';
import { requireAdmin } from './auth';
import { listAllKeys } from '../lib/kv-helpers';

export const draftRoutes = new Hono<{ Bindings: Env }>();

const MAX_DRAFTS_PER_AUTHOR = 50;
const MAX_BODY_BYTES = 512_000;

// P001-PAI-0036: field length caps matching article endpoint
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 1000;
const MAX_SLUG = 100;
const MAX_TAGS = 10;
const MAX_TAG_LEN = 50;

// P001-PAI-0036: sanitize draft bodies with same allowlist as articles
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: Array.from(ALLOWED_TAGS),
  allowedAttributes: Object.fromEntries(
    Object.entries(ALLOWED_ATTRIBUTES).map(([tag, attrs]) => [tag, Array.from(attrs)]),
  ),
  allowedStyles: Object.fromEntries(
    Object.entries(ALLOWED_STYLES).map(([tag, decls]) => [
      tag,
      Object.fromEntries(
        Object.entries(decls).map(([prop, regs]) => [prop, Array.from(regs)]),
      ),
    ]),
  ),
  allowedSchemes: Array.from(ALLOWED_SCHEMES),
};

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

  // P001-PAI-0036: field length validation matching article caps
  if (typeof payload.title === 'string' && payload.title.length > MAX_TITLE) {
    return c.json({ error: `title must be 0..${MAX_TITLE} chars` }, 400);
  }
  if (typeof payload.description === 'string' && payload.description.length > MAX_DESCRIPTION) {
    return c.json({ error: `description must be 0..${MAX_DESCRIPTION} chars` }, 400);
  }
  if (typeof payload.slug === 'string' && payload.slug.length > MAX_SLUG) {
    return c.json({ error: `slug must be 0..${MAX_SLUG} chars` }, 400);
  }
  if (Array.isArray(payload.tags)) {
    if (payload.tags.length > MAX_TAGS) {
      return c.json({ error: `tags must be an array of up to ${MAX_TAGS}` }, 400);
    }
    for (const t of payload.tags) {
      if (typeof t !== 'string' || t.length > MAX_TAG_LEN) {
        return c.json({ error: `each tag must be at most ${MAX_TAG_LEN} chars` }, 400);
      }
    }
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
  // P001-PAI-0036: sanitize draft body with same allowlist as articles
  const cleanBody = payload.body ? sanitizeHtml(payload.body, SANITIZE_OPTIONS) : '';
  const draft: StoredDraft = {
    draftId,
    slug: payload.slug ?? '',
    title: payload.title ?? '',
    description: payload.description ?? '',
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 5) : [],
    priceEth: payload.priceEth ?? '0.001',
    maxSupply: payload.maxSupply ?? '0',
    coverImage: payload.coverImage,
    body: cleanBody,
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
