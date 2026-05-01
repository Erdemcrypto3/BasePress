import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAdmin } from './auth';

export const tagRoutes = new Hono<{ Bindings: Env }>();

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

  const list = await kv.list({ prefix: 'tag:' });
  for (const k of list.keys) {
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

  const { name } = await c.req.json<{ name: string }>();
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return c.json({ error: 'name required' }, 400);
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

  const slug = c.req.param('slug');
  const raw = await c.env.ARTICLES.get(tagKey(slug));
  if (!raw) return c.json({ error: 'not found' }, 404);

  const tag = JSON.parse(raw) as StoredTag;
  const update = await c.req.json<{ active?: boolean; name?: string }>();

  if (typeof update.active === 'boolean') tag.active = update.active;
  if (typeof update.name === 'string' && update.name.trim()) tag.name = update.name.trim();
  tag.updatedAt = Math.floor(Date.now() / 1000);

  await c.env.ARTICLES.put(tagKey(slug), JSON.stringify(tag));
  return c.json({ ok: true, tag });
});
