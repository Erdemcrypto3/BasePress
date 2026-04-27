import { API_URL } from './contract';

// ===== Types mirrored from basepress-api =====

export type ArticleListItem = {
  articleId: `0x${string}`;
  slug: string;
  title: string;
  description: string;
  coverImage?: string;
  tags: string[];
  author: `0x${string}`;
  publishedAt: number; // unix seconds
  permit: MintPermit;
  signature: `0x${string}`;
};

export type MintPermit = {
  articleId: `0x${string}`;
  contentURI: string;
  author: `0x${string}`;
  price: string;       // bigint as decimal string for JSON
  maxSupply: string;
  deadline: number;
};

// ===== Public read endpoints =====

export async function fetchArticles(): Promise<ArticleListItem[]> {
  const r = await fetch(`${API_URL}/articles`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Failed to fetch articles (${r.status})`);
  const data = await r.json();
  return data.articles ?? [];
}

export async function fetchArticleContent(contentURI: string): Promise<string> {
  // contentURI is an R2 URL served by the worker — no auth needed for reads.
  const r = await fetch(contentURI, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Failed to fetch article content (${r.status})`);
  return r.text();
}

// ===== Admin (SIWE-gated) endpoints =====

export type SiweSession = { token: string; address: `0x${string}`; expiresAt: number };

export async function siweNonce(address: `0x${string}`): Promise<{ nonce: string; message: string }> {
  const r = await fetch(`${API_URL}/auth/nonce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!r.ok) throw new Error('Nonce request failed');
  return r.json();
}

export async function siweVerify(message: string, signature: `0x${string}`): Promise<SiweSession> {
  const r = await fetch(`${API_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature }),
  });
  if (!r.ok) throw new Error('SIWE verify failed');
  return r.json();
}

export async function publishArticle(
  token: string,
  payload: {
    slug: string;
    title: string;
    description: string;
    body: string; // sanitized HTML
    tags: string[];
    coverImage?: string;
    permit: MintPermit;
    signature: `0x${string}`;
  },
): Promise<{ ok: true; articleId: `0x${string}` }> {
  const r = await fetch(`${API_URL}/articles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Publish failed (${r.status})`);
  return r.json();
}
