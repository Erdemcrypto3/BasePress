import { keccak256, stringToBytes } from 'viem';

// articleId is opaque on-chain (bytes32). Derived deterministically from
// (author, slug) so the same (author, slug) pair always maps to the same
// articleId — enforcing slug uniqueness per author. The API rejects duplicate
// articleIds, so a republish with the same slug fails fast.
export function deriveArticleId(input: {
  author: string;
  slug: string;
}): `0x${string}` {
  const norm = `basepress:${input.author.toLowerCase()}:${input.slug}`;
  return keccak256(stringToBytes(norm));
}
