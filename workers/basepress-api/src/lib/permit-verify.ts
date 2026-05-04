import { recoverTypedDataAddress, type TypedDataDomain } from 'viem';

// Mirror of apps/web/app/lib/contract.ts CONTRACT_ADDRESSES.
// Keep in sync when deploying to a new chain.
const CONTRACT_ADDRESSES: Record<number, `0x${string}`> = {
  8453: '0xAdf3d339B1030ac84fa56430C6a86455fBCEA5cd', // Base
  57073: '0xcaf3D13E55fc7c62c1fea07dcD3FbA0D682080Ab', // Ink
};

const PERMIT_DOMAIN_NAME = 'BasePress';
const PERMIT_DOMAIN_VERSION = '1';

const MINT_PERMIT_TYPES = {
  MintPermit: [
    { name: 'articleId', type: 'bytes32' },
    { name: 'author', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export type PermitMessage = {
  articleId: `0x${string}`;
  author: `0x${string}`;
  deadline: bigint;
};

// PAI-0017: recover the signer for a (permit, chainId, signature) triple and
// return the lowercase address. Returns null if the chain is unknown or the
// signature is malformed.
export async function recoverPermitSigner(
  permit: PermitMessage,
  chainId: number,
  signature: `0x${string}`,
): Promise<string | null> {
  const verifyingContract = CONTRACT_ADDRESSES[chainId];
  if (!verifyingContract) return null;

  const domain: TypedDataDomain = {
    name: PERMIT_DOMAIN_NAME,
    version: PERMIT_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };

  try {
    const recovered = await recoverTypedDataAddress({
      domain,
      types: MINT_PERMIT_TYPES,
      primaryType: 'MintPermit',
      message: permit,
      signature,
    });
    return recovered.toLowerCase();
  } catch {
    return null;
  }
}

export function isKnownChainId(chainId: number): boolean {
  return chainId in CONTRACT_ADDRESSES;
}
