import { API_URL } from './contract';

// ===== Types mirrored from basepress-api =====

export type ArticleSignature = {
  chainId: number;
  signature: `0x${string}`;
};

export type ArticleListItem = {
  articleId: `0x${string}`;
  slug: string;
  title: string;
  description: string;
  coverImage?: string;
  tags: string[];
  author: `0x${string}`;
  publishedAt: number; // unix seconds
  // PAI-0016: canonical R2 path for the article body — readers MUST use this,
  // not permit.contentURI (which is admin-controlled and only on-chain hash bound).
  contentKey: string;
  permit: MintPermit;
  signatures: ArticleSignature[];
  hidden?: boolean;
};

export type MintPermit = {
  articleId: `0x${string}`;
  contentURI: string;
  author: `0x${string}`;
  price: string;       // wei as decimal string for JSON safety
  maxSupply: string;
  deadline: number;
};

// ===== Public read endpoints =====

export async function fetchArticles(token?: string): Promise<ArticleListItem[]> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API_URL}/articles`, { cache: 'no-store', headers });
  if (!r.ok) throw new Error(`Failed to fetch articles (${r.status})`);
  const data = await r.json();
  return data.articles ?? [];
}

export async function toggleArticleVisibility(
  token: string,
  articleId: string,
  hidden: boolean,
): Promise<{ ok: true; hidden: boolean }> {
  const r = await fetch(`${API_URL}/articles/${articleId}/visibility`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ hidden }),
  });
  if (!r.ok) throw new Error(`Toggle visibility failed (${r.status})`);
  return r.json();
}

export async function fetchArticle(articleId: string, token?: string): Promise<ArticleListItem> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API_URL}/articles/${articleId}`, { cache: 'no-store', headers });
  if (!r.ok) throw new Error(`Failed to fetch article (${r.status})`);
  return r.json();
}

// PAI-0016: read body from canonical contentKey, never from admin-controlled
// permit.contentURI. Caller passes contentKey (e.g. "articles/0xabc.../body.html").
export async function fetchArticleContent(contentKey: string): Promise<string> {
  const r = await fetch(`${API_URL}/file/${contentKey}`, { cache: 'no-store' });
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
    signatures: ArticleSignature[];
  },
): Promise<{ ok: true; articleId: `0x${string}` }> {
  const r = await fetch(`${API_URL}/articles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Publish failed (${r.status}) ${text}`);
  }
  return r.json();
}

// ===== Tag endpoints =====

export type Tag = {
  slug: string;
  name: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export async function fetchActiveTags(): Promise<Tag[]> {
  const r = await fetch(`${API_URL}/tags`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Failed to fetch tags (${r.status})`);
  const data = await r.json();
  return data.tags ?? [];
}

export async function fetchAllTags(token: string): Promise<Tag[]> {
  const r = await fetch(`${API_URL}/tags/all`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Failed to fetch tags (${r.status})`);
  const data = await r.json();
  return data.tags ?? [];
}

export async function createTag(token: string, name: string): Promise<Tag> {
  const r = await fetch(`${API_URL}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Create tag failed (${r.status}) ${text}`);
  }
  const data = await r.json();
  return data.tag;
}

export async function updateTag(
  token: string,
  slug: string,
  update: { active?: boolean; name?: string },
): Promise<Tag> {
  const r = await fetch(`${API_URL}/tags/${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(update),
  });
  if (!r.ok) throw new Error(`Update tag failed (${r.status})`);
  const data = await r.json();
  return data.tag;
}

// ===== Draft endpoints =====

export type Draft = {
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

export async function listDrafts(token: string): Promise<Draft[]> {
  const r = await fetch(`${API_URL}/drafts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Failed to list drafts (${r.status})`);
  const data = await r.json();
  return data.drafts ?? [];
}

export async function getDraft(token: string, draftId: string): Promise<Draft> {
  const r = await fetch(`${API_URL}/drafts/${draftId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Failed to get draft (${r.status})`);
  return r.json();
}

export async function saveDraft(
  token: string,
  draftId: string,
  payload: Omit<Draft, 'draftId' | 'createdAt' | 'updatedAt'>,
): Promise<{ ok: true; draft: Draft }> {
  const r = await fetch(`${API_URL}/drafts/${draftId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Save draft failed (${r.status}) ${text}`);
  }
  return r.json();
}

export async function deleteDraft(token: string, draftId: string): Promise<void> {
  const r = await fetch(`${API_URL}/drafts/${draftId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Delete draft failed (${r.status})`);
}

// ===== File upload =====

export async function uploadCover(
  token: string,
  file: File,
): Promise<{ key: string; url: string }> {
  const r = await fetch(`${API_URL}/file/cover`, {
    method: 'POST',
    headers: { 'Content-Type': file.type, Authorization: `Bearer ${token}` },
    body: file,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Cover upload failed (${r.status}) ${text}`);
  }
  return r.json();
}
