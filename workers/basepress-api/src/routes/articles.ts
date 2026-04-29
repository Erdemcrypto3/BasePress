import { Hono } from 'hono';
import sanitizeHtml from 'sanitize-html';
import type { Env } from '../index';
import { requireAdmin } from './auth';

export const articleRoutes = new Hono<{ Bindings: Env }>();

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'del', 's']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ['src', 'alt', 'width', 'height'],
    a: ['href', 'target', 'rel'],
  },
  allowedSchemes: ['https'],
};

type ArticleSignature = {
  chainId: number;
  signature: `0x${string}`;
};

type StoredPermit = {
  articleId: `0x${string}`;
  contentURI: string;
  author: `0x${string}`;
  price: string;
  maxSupply: string;
  deadline: number;
};

type StoredArticle = {
  articleId: `0x${string}`;
  slug: string;
  title: string;
  description: string;
  coverImage?: string;
  tags: string[];
  author: `0x${string}`;
  publishedAt: number;
  contentKey: string;
  permit: StoredPermit;
  signatures: ArticleSignature[];
};

// PAI-0014: paginated public list
articleRoutes.get('/', async (c) => {
  const limitParam = parseInt(c.req.query('limit') || '', 10);
  const offsetParam = parseInt(c.req.query('offset') || '', 10);
  const limit = Math.min(Math.max(limitParam || DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(offsetParam || 0, 0);

  const list = await c.env.ARTICLES.list({ prefix: 'article:' });
  const articles: StoredArticle[] = [];
  for (const k of list.keys) {
    const raw = await c.env.ARTICLES.get(k.name);
    if (raw) articles.push(JSON.parse(raw));
  }
  articles.sort((a, b) => b.publishedAt - a.publishedAt);

  const total = articles.length;
  const page = articles.slice(offset, offset + limit);
  return c.json({ articles: page, total, limit, offset });
});

articleRoutes.get('/:articleId', async (c) => {
  const id = c.req.param('articleId');
  const raw = await c.env.ARTICLES.get(`article:${id}`);
  if (!raw) return c.json({ error: 'not found' }, 404);
  return c.json(JSON.parse(raw));
});

// ----- Admin publish -----
articleRoutes.post('/', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);

  const payload = await c.req.json<{
    slug: string;
    title: string;
    description: string;
    body: string;
    tags: string[];
    coverImage?: string;
    permit: StoredPermit;
    signatures: ArticleSignature[];
  }>();

  const articleId = payload.permit?.articleId;
  if (!/^0x[a-f0-9]{64}$/i.test(articleId)) return c.json({ error: 'bad articleId' }, 400);
  if (payload.permit.author.toLowerCase() !== admin.toLowerCase()) {
    return c.json({ error: 'permit.author must equal SIWE admin address' }, 400);
  }
  if (!Array.isArray(payload.signatures) || payload.signatures.length === 0) {
    return c.json({ error: 'at least one chain signature required' }, 400);
  }
  for (const s of payload.signatures) {
    if (typeof s.chainId !== 'number') return c.json({ error: 'bad chainId' }, 400);
    if (!/^0x[a-f0-9]+$/i.test(s.signature)) return c.json({ error: 'bad signature' }, 400);
  }

  // PAI-0010: reject overwrite — once published, an article is immutable
  const existing = await c.env.ARTICLES.get(`article:${articleId}`);
  if (existing) {
    await c.env.ARTICLES.put(
      `audit:overwrite-attempt:${articleId}:${Date.now()}`,
      JSON.stringify({ by: admin, at: new Date().toISOString() }),
      { expirationTtl: 86400 * 30 },
    );
    return c.json({ error: 'article already exists — published articles are immutable' }, 409);
  }

  // PAI-0013: validate coverImage origin if provided
  if (payload.coverImage) {
    try {
      const coverOrigin = new URL(payload.coverImage).origin;
      const apiOrigin = new URL(c.req.url).origin;
      if (coverOrigin !== apiOrigin && coverOrigin !== new URL(c.env.ALLOWED_ORIGIN).origin) {
        return c.json({ error: 'coverImage must be hosted on the API or app domain' }, 400);
      }
    } catch {
      return c.json({ error: 'coverImage must be a valid URL' }, 400);
    }
  }

  // PAI-0003: server-side HTML sanitization
  const cleanBody = sanitizeHtml(payload.body, SANITIZE_OPTIONS);

  const contentKey = `articles/${articleId}/body.html`;
  await c.env.STORAGE.put(contentKey, cleanBody, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });

  const stored: StoredArticle = {
    articleId,
    slug: payload.slug,
    title: payload.title,
    description: payload.description,
    coverImage: payload.coverImage,
    tags: payload.tags,
    author: payload.permit.author,
    publishedAt: Math.floor(Date.now() / 1000),
    contentKey,
    permit: payload.permit,
    signatures: payload.signatures,
  };
  await c.env.ARTICLES.put(`article:${articleId}`, JSON.stringify(stored));

  return c.json({ ok: true, articleId });
});
