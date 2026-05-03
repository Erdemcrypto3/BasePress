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
import { recoverPermitSigner, isKnownChainId } from '../lib/permit-verify';
import { listAllKeys } from '../lib/kv-helpers';
// P001-PAI-0039: per-session rate limiting on write endpoints
import { checkRateLimit, getClientIp } from '../lib/rate-limit';

export const articleRoutes = new Hono<{ Bindings: Env }>();

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

// PAI-0020: size + shape caps for POST /articles
const MAX_BODY_BYTES = 256 * 1024; // 256 KB JSON payload cap
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 1000;
const MAX_SLUG = 100;
const MAX_TAGS = 10;
const MAX_TAG_LEN = 50;

// P001-PAI-0039: rate-limit caps for write endpoints
const RATE_LIMIT_PUBLISH = 5; // max 5 publishes per 60 s
const RATE_LIMIT_VISIBILITY = 20; // max 20 visibility toggles per 60 s

// P001-PAI-0040: strip HTML tags and Unicode control characters from plain-text
// fields (title, description, tags). Prevents stored-XSS for future API consumers
// that don't auto-escape like React does.
function stripPlainText(input: string): string {
  // Strip all HTML tags by running sanitize-html with zero allowed tags
  const noHtml = sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} });
  // Remove Unicode control characters (C0, C1, DEL) except common whitespace
  // eslint-disable-next-line no-control-regex
  return noHtml.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
}

// PAI-0025: allowlist sourced from @basepress/sanitizer so server and client
// strip the same tags/attributes/URI schemes.
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
  hidden?: boolean;
};

// PAI-0014: paginated public list
articleRoutes.get('/', async (c) => {
  const limitParam = parseInt(c.req.query('limit') || '', 10);
  const offsetParam = parseInt(c.req.query('offset') || '', 10);
  const limit = Math.min(Math.max(limitParam || DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(offsetParam || 0, 0);

  const isAdmin = !!(await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin')));

  // P001-PAI-0032: use cursor-based pagination to fetch all article keys
  const allKeys = await listAllKeys(c.env.ARTICLES, { prefix: 'article:' });
  const articles: StoredArticle[] = [];
  for (const k of allKeys) {
    const raw = await c.env.ARTICLES.get(k.name);
    if (raw) {
      const article = JSON.parse(raw) as StoredArticle;
      if (!isAdmin && article.hidden) continue;
      articles.push(article);
    }
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
  const article = JSON.parse(raw) as StoredArticle;
  const isAdmin = !!(await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin')));
  if (article.hidden && !isAdmin) return c.json({ error: 'not found' }, 404);
  return c.json(article);
});

// ----- Admin publish -----
articleRoutes.post('/', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);

  // P001-PAI-0039: per-session rate limit on article publish
  const ip = getClientIp(c);
  if (!(await checkRateLimit(c.env.SESSIONS, 'publish', `${admin}:${ip}`, RATE_LIMIT_PUBLISH))) {
    return c.json({ error: 'rate limit exceeded, try again later' }, 429);
  }

  // PAI-0020: hard cap on payload size (cheap header check first)
  const declaredLen = parseInt(c.req.header('content-length') || '0', 10);
  if (declaredLen > MAX_BODY_BYTES) {
    return c.json({ error: `payload too large (max ${MAX_BODY_BYTES} bytes)` }, 413);
  }
  const rawBody = await c.req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return c.json({ error: `payload too large (max ${MAX_BODY_BYTES} bytes)` }, 413);
  }

  let payload: {
    slug: string;
    title: string;
    description: string;
    body: string;
    tags: string[];
    coverImage?: string;
    permit: StoredPermit;
    signatures: ArticleSignature[];
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'malformed JSON' }, 400);
  }

  const articleId = payload.permit?.articleId;
  if (!/^0x[a-f0-9]{64}$/i.test(articleId)) return c.json({ error: 'bad articleId' }, 400);
  if (payload.permit.author.toLowerCase() !== admin.toLowerCase()) {
    return c.json({ error: 'permit.author must equal SIWE admin address' }, 400);
  }
  // PAI-0020: shape caps on text fields
  if (typeof payload.slug !== 'string' || payload.slug.length === 0 || payload.slug.length > MAX_SLUG) {
    return c.json({ error: `slug must be 1..${MAX_SLUG} chars` }, 400);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(payload.slug)) {
    return c.json({ error: 'slug must match [a-z0-9-]' }, 400);
  }
  if (typeof payload.title !== 'string' || payload.title.length === 0 || payload.title.length > MAX_TITLE) {
    return c.json({ error: `title must be 1..${MAX_TITLE} chars` }, 400);
  }
  if (typeof payload.description !== 'string' || payload.description.length > MAX_DESCRIPTION) {
    return c.json({ error: `description must be 0..${MAX_DESCRIPTION} chars` }, 400);
  }
  if (!Array.isArray(payload.tags) || payload.tags.length > MAX_TAGS) {
    return c.json({ error: `tags must be an array of up to ${MAX_TAGS}` }, 400);
  }
  for (const t of payload.tags) {
    if (typeof t !== 'string' || t.length === 0 || t.length > MAX_TAG_LEN) {
      return c.json({ error: `each tag must be 1..${MAX_TAG_LEN} chars` }, 400);
    }
  }
  if (!Array.isArray(payload.signatures) || payload.signatures.length === 0) {
    return c.json({ error: 'at least one chain signature required' }, 400);
  }
  for (const s of payload.signatures) {
    if (typeof s.chainId !== 'number') return c.json({ error: 'bad chainId' }, 400);
    if (!/^0x[a-f0-9]+$/i.test(s.signature)) return c.json({ error: 'bad signature' }, 400);
  }

  // PAI-0017: cryptographically verify every signature recovers to PLATFORM_SIGNER.
  // Reject the publish if any signature is invalid — defense against admin
  // session compromise without signer-key compromise, and surfaces wallet
  // domain-mismatch bugs at publish time instead of at mint time.
  const expectedSigner = c.env.PLATFORM_SIGNER?.toLowerCase();
  if (!expectedSigner || !/^0x[a-f0-9]{40}$/i.test(expectedSigner)) {
    return c.json({ error: 'server misconfigured: PLATFORM_SIGNER missing' }, 500);
  }
  const permitMessage = {
    articleId: payload.permit.articleId,
    contentURI: payload.permit.contentURI,
    author: payload.permit.author,
    price: BigInt(payload.permit.price),
    maxSupply: BigInt(payload.permit.maxSupply),
    deadline: BigInt(payload.permit.deadline),
  };
  for (const s of payload.signatures) {
    if (!isKnownChainId(s.chainId)) {
      return c.json({ error: `unknown chainId ${s.chainId}` }, 400);
    }
    const recovered = await recoverPermitSigner(permitMessage, s.chainId, s.signature);
    if (recovered === null) {
      return c.json({ error: `signature recovery failed on chain ${s.chainId}` }, 400);
    }
    if (recovered !== expectedSigner) {
      return c.json(
        { error: `signature on chain ${s.chainId} does not match platformSigner` },
        400,
      );
    }
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

  // PAI-0016: enforce canonical contentURI — readers route via contentKey,
  // but the on-chain permit's contentURI MUST point at our canonical R2 path
  // so on-chain readers (block explorers, indexers) can trust the link.
  const apiOrigin = new URL(c.req.url).origin;
  const expectedContentURI = `${apiOrigin}/file/articles/${articleId}/body.html`;
  if (payload.permit.contentURI !== expectedContentURI) {
    return c.json({ error: 'permit.contentURI must equal canonical R2 path' }, 400);
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

  // P001-PAI-0040: sanitize plain-text fields (strip HTML + control chars)
  payload.title = stripPlainText(payload.title);
  payload.description = stripPlainText(payload.description);
  payload.tags = payload.tags.map(stripPlainText);

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

articleRoutes.put('/:articleId/visibility', async (c) => {
  const admin = await requireAdmin(c.env, c.req.header('Authorization'), c.req.header('origin'));
  if (!admin) return c.json({ error: 'unauthorized' }, 401);

  // P001-PAI-0039: per-session rate limit on visibility toggle
  const ip = getClientIp(c);
  if (!(await checkRateLimit(c.env.SESSIONS, 'visibility', `${admin}:${ip}`, RATE_LIMIT_VISIBILITY))) {
    return c.json({ error: 'rate limit exceeded, try again later' }, 429);
  }

  const id = c.req.param('articleId');
  const raw = await c.env.ARTICLES.get(`article:${id}`);
  if (!raw) return c.json({ error: 'not found' }, 404);

  const article = JSON.parse(raw) as StoredArticle;
  const { hidden } = await c.req.json<{ hidden: boolean }>();
  article.hidden = hidden;
  await c.env.ARTICLES.put(`article:${id}`, JSON.stringify(article));

  return c.json({ ok: true, hidden: article.hidden });
});
