import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAdmin } from './auth';
import { listAllKeys } from '../lib/kv-helpers';
// P001-PAI-0039: per-session rate limiting on write endpoints
import { checkRateLimit, getClientIp } from '../lib/rate-limit';

export const tagRoutes = new Hono<{ Bindings: Env }>();

// P001-PAI-0039: rate-limit caps for tag write endpoints
const RATE_LIMIT_TAG_WRITE = 10; // create/update per 60 s
// P001-PAI-0059: cap tag name length to match drafts MAX_TAG_LEN
const MAX_TAG_NAME_LEN = 50;

type StoredTag = {
  slug: string;
  name: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

const TAG_INDEX_KEY = 'tag:__index__';

function tagKey(slug: string): string {
  return `tag:${slug}`;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function getIndex(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get(TAG_INDEX_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as string[];
}

async function putIndex(kv: KVNamespace, slugs: string[]): Promise<void> {
  await kv.put(TAG_INDEX_KEY, JSON.stringify(slugs));
}

async function allTags(kv: KVNamespace): Promise<StoredTag[]> {
  const indexSlugs = await getIndex(kv);
  const seen = new Set<string>();
  const tags: StoredTag[] = [];

  for (const slug of indexSlugs) {
    const raw = await kv.get(tagKey(slug));
    if (raw) {
      tags.push(JSON.parse(raw));
      seen.add(slug);
    }
  }

  // P001-PAI-0032: use cursor-based pagination to fetch all tag keys
  const allKeys = await listAllKeys(kv, { prefix: 'tag:' });
  for (const k of allKeys) {
    if (k.name === TAG_INDEX_KEY) continue;
    const slug = k.name.slice(4);
    if (seen.has(slug)) continue;
    const raw = await kv.get(k.name);
    if (raw) {
      tags.push(JSON.parse(raw));
      indexSlugs.push(slug);
    }
  }

  if (indexSlugs.length > seen.size) {
    await putIndex(kv, indexSlugs);
  }

  tags.sort((a, b) => a.name.localeCompare(b.name));
  return tags;
}

tagRoutes.get('/', async (c) => {
  const tags = await allTags(c.env.ARTICLES);
  return c.json({ tags: tags.filter((t) => t.active) });
});

tagRoutes.get('/all', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);
  const tags = await allTags(c.env.ARTICLES);
  return c.json({ tags });
});

tagRoutes.post('/', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);

  // P001-PAI-0039: per-session rate limit on tag creation
  const ip = getClientIp(c);
  if (!(await checkRateLimit(c.env.SESSIONS, 'tag-write', `${admin}:${ip}`, RATE_LIMIT_TAG_WRITE))) {
    return c.json({ error: 'rate limit exceeded, try again later' }, 429);
  }

  const { name } = await c.req.json<{ name: string }>();
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return c.json({ error: 'name required' }, 400);
  }
  // P001-PAI-0059: enforce tag name length cap
  if (name.trim().length > MAX_TAG_NAME_LEN) {
    return c.json({ error: `name must be ${MAX_TAG_NAME_LEN} characters or fewer` }, 400);
  }

  const slug = slugify(name.trim());
  if (!slug) return c.json({ error: 'invalid name' }, 400);

  const existing = await c.env.ARTICLES.get(tagKey(slug));
  if (existing) return c.json({ error: 'tag already exists' }, 409);

  const now = Math.floor(Date.now() / 1000);
  const tag: StoredTag = {
    slug,
    name: name.trim(),
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  await c.env.ARTICLES.put(tagKey(slug), JSON.stringify(tag));

  const index = await getIndex(c.env.ARTICLES);
  if (!index.includes(slug)) {
    index.push(slug);
    await putIndex(c.env.ARTICLES, index);
  }

  return c.json({ ok: true, tag });
});

tagRoutes.put('/:slug', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);

  // P001-PAI-0039: per-session rate limit on tag update
  const ip = getClientIp(c);
  if (!(await checkRateLimit(c.env.SESSIONS, 'tag-write', `${admin}:${ip}`, RATE_LIMIT_TAG_WRITE))) {
    return c.json({ error: 'rate limit exceeded, try again later' }, 429);
  }

  const slug = c.req.param('slug');
  const raw = await c.env.ARTICLES.get(tagKey(slug));
  if (!raw) return c.json({ error: 'not found' }, 404);

  const tag = JSON.parse(raw) as StoredTag;
  const update = await c.req.json<{ active?: boolean; name?: string }>();

  // P001-PAI-0059: enforce tag name length cap on update
  if (typeof update.name === 'string' && update.name.trim().length > MAX_TAG_NAME_LEN) {
    return c.json({ error: `name must be ${MAX_TAG_NAME_LEN} characters or fewer` }, 400);
  }

  // P001-PAI-0042: reject name changes — slug and name must stay consistent.
  // To rename a tag, delete it and create a new one so the slug is regenerated.
  if (typeof update.name === 'string' && update.name.trim() && update.name.trim() !== tag.name) {
    return c.json({ error: 'name changes not allowed; delete and recreate the tag instead' }, 400);
  }

  if (typeof update.active === 'boolean') tag.active = update.active;
  tag.updatedAt = Math.floor(Date.now() / 1000);

  await c.env.ARTICLES.put(tagKey(slug), JSON.stringify(tag));
  return c.json({ ok: true, tag });
});
