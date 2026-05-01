'use client';

import { useReadContract } from '@basepress/wallet';
import { SUPPORTED_CHAINS } from '@basepress/chain';
import { BASEPRESS_ABI, getContractAddress } from '../lib/contract';

type Props = { articleId: `0x${string}`; className?: string };

export function MintCount({ articleId, className }: Props) {
  const chains = SUPPORTED_CHAINS.filter((c) => getContractAddress(c.id) !== null);

  return (
    <span className={className}>
      {chains.map((c, i) => (
        <ChainMintCount key={c.id} chainId={c.id} chainName={c.name} articleId={articleId} last={i === chains.length - 1} />
      ))}
    </span>
  );
}

function ChainMintCount({
  chainId,
  chainName,
  articleId,
  last,
}: {
  chainId: number;
  chainName: string;
  articleId: `0x${string}`;
  last: boolean;
}) {
  const contract = getContractAddress(chainId) as `0x${string}`;
  const { data: supply } = useReadContract({
    abi: BASEPRESS_ABI,
    address: contract,
    chainId,
    functionName: 'articleSupply',
    args: [articleId],
  });

  const count = supply !== undefined ? supply.toString() : '–';
  return (
    <>
      {chainName} {count}
      {!last && ' · '}
    </>
  );
}
