import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAdmin } from './auth';

export const articleRoutes = new Hono<{ Bindings: Env }>();

type ArticleSignature = {
  chainId: number;
  signature: `0x${string}`;
};

type StoredPermit = {
  articleId: `0x${string}`;
  contentURI: string;
  author: `0x${string}`;
  price: string;       // wei as decimal string
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

// ----- Public list -----
articleRoutes.get('/', async (c) => {
  const list = await c.env.ARTICLES.list({ prefix: 'article:' });
  const articles: StoredArticle[] = [];
  for (const k of list.keys) {
    const raw = await c.env.ARTICLES.get(k.name);
    if (raw) articles.push(JSON.parse(raw));
  }
  articles.sort((a, b) => b.publishedAt - a.publishedAt);
  return c.json({ articles });
});

articleRoutes.get('/:articleId', async (c) => {
  const id = c.req.param('articleId');
  const raw = await c.env.ARTICLES.get(`article:${id}`);
  if (!raw) return c.json({ error: 'not found' }, 404);
  return c.json(JSON.parse(raw));
});

// ----- Admin publish -----
articleRoutes.post('/', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'));
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

  // Body sanitization is the publisher's responsibility (they sign a permit
  // tied to articleId, not body content). Worker stores verbatim.
  const contentKey = `articles/${articleId}/body.html`;
  await c.env.STORAGE.put(contentKey, payload.body, {
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
