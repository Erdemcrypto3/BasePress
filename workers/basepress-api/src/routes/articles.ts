import { Hono } from 'hono';
import type { Env } from '../index';
import { requireAdmin } from './auth';

export const articleRoutes = new Hono<{ Bindings: Env }>();

type StoredArticle = {
  articleId: `0x${string}`;
  slug: string;
  title: string;
  description: string;
  coverImage?: string;
  tags: string[];
  author: `0x${string}`;
  publishedAt: number;
  contentKey: string;          // R2 object key for the body
  permit: unknown;             // MintPermit (bytes32 articleId, string contentURI, address author, uint256 price, uint256 maxSupply, uint256 deadline)
  signature: `0x${string}`;
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
    permit: { articleId: `0x${string}`; author: `0x${string}` } & Record<string, unknown>;
    signature: `0x${string}`;
  }>();

  // Body sanitization is the publisher's responsibility (they sign the permit
  // referencing the contentURI we return). Worker stores verbatim.
  const articleId = payload.permit.articleId;
  if (!/^0x[a-f0-9]{64}$/i.test(articleId)) return c.json({ error: 'bad articleId' }, 400);

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
    signature: payload.signature,
  };
  await c.env.ARTICLES.put(`article:${articleId}`, JSON.stringify(stored));

  return c.json({ ok: true, articleId });
});
