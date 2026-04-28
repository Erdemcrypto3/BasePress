import { keccak256, stringToBytes } from 'viem';

// articleId is opaque on-chain (bytes32). We derive it deterministically from
// (author, slug, nonce) so two parallel publishes can't collide and a republish
// of the same slug under a fresh nonce gets a fresh article-state on-chain.
export function deriveArticleId(input: {
  author: string;
  slug: string;
  nonce: string;
}): `0x${string}` {
  const norm = `basepress:${input.author.toLowerCase()}:${input.slug}:${input.nonce}`;
  return keccak256(stringToBytes(norm));
}

export function newNonce(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
