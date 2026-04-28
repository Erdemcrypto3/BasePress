'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatEther } from 'viem';
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from '@basepress/wallet';
import { SUPPORTED_CHAINS } from '@basepress/chain';
import type { ArticleListItem } from '../lib/api';
import { BASEPRESS_ABI, getContractAddress } from '../lib/contract';

type Props = { article: ArticleListItem };

export function MintCard({ article }: Props) {
  const { isConnected } = useAccount();
  const activeChainId = useChainId();
  const { switchChainAsync, isPending: switching } = useSwitchChain();

  // Chains where this specific article is mintable: must have both a stored
  // signature and a deployed contract address.
  const mintableChains = useMemo(() => {
    return article.signatures
      .map((s) => SUPPORTED_CHAINS.find((c) => c.id === s.chainId))
      .filter((c): c is (typeof SUPPORTED_CHAINS)[number] => Boolean(c))
      .filter((c) => getContractAddress(c.id) !== null);
  }, [article.signatures]);

  const [selectedChainId, setSelectedChainId] = useState<number | null>(
    mintableChains[0]?.id ?? null,
  );

  useEffect(() => {
    if (selectedChainId === null && mintableChains[0]) {
      setSelectedChainId(mintableChains[0].id);
    }
  }, [mintableChains, selectedChainId]);

  const selectedChain = mintableChains.find((c) => c.id === selectedChainId) ?? null;
  const contract = selectedChain ? getContractAddress(selectedChain.id) : null;
  const signatureForChain = useMemo(
    () =>
      selectedChain
        ? article.signatures.find((s) => s.chainId === selectedChain.id)?.signature
        : undefined,
    [article.signatures, selectedChain],
  );

  const priceWei = useMemo(() => BigInt(article.permit.price || '0'), [article.permit.price]);
  const maxSupply = article.permit.maxSupply;

  // On-chain reads — supply minted so far on the selected chain.
  const { data: mintedSoFar, refetch: refetchSupply } = useReadContract({
    abi: BASEPRESS_ABI,
    address: (contract ?? undefined) as `0x${string}` | undefined,
    chainId: selectedChain?.id,
    functionName: 'articleSupply',
    args: [article.articleId],
    query: { enabled: !!contract && !!selectedChain },
  });

  const {
    writeContract,
    data: txHash,
    isPending: writing,
    reset: resetWrite,
    error: writeError,
  } = useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: selectedChain?.id,
  });

  useEffect(() => {
    if (confirmed) refetchSupply();
  }, [confirmed, refetchSupply]);

  const onMint = async () => {
    if (!selectedChain || !contract || !signatureForChain) return;
    if (activeChainId !== selectedChain.id) {
      try {
        await switchChainAsync({ chainId: selectedChain.id });
      } catch (e) {
        // user rejected — show the error in the panel
        return;
      }
    }
    resetWrite();
    writeContract({
      abi: BASEPRESS_ABI,
      address: contract,
      chainId: selectedChain.id,
      functionName: 'mintWithPermit',
      args: [
        {
          articleId: article.articleId,
          contentURI: article.permit.contentURI,
          author: article.permit.author,
          price: priceWei,
          maxSupply: BigInt(maxSupply || '0'),
          deadline: BigInt(article.permit.deadline || 0),
        },
        signatureForChain,
      ],
      value: priceWei,
    });
  };

  const supplyLabel = (() => {
    if (mintedSoFar === undefined) return '—';
    const total = maxSupply === '0' ? '∞' : maxSupply;
    return `${mintedSoFar.toString()} / ${total}`;
  })();

  const errorMsg = writeError
    ? ((writeError as Error & { shortMessage?: string }).shortMessage ?? writeError.message)
    : null;

  if (mintableChains.length === 0) {
    return (
      <div className="rounded-xl bg-amber-50 p-5 ring-1 ring-inset ring-amber-200 text-sm text-amber-800">
        This article has no mint signatures for any deployed chain.
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-inset ring-base-100 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-base-900">Mint as NFT</h3>
        <span className="text-xs text-base-500">Pay-once · ERC-1155</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Stat label="Price">{formatEther(priceWei)} ETH</Stat>
        <Stat label="Minted">{supplyLabel}</Stat>
        <Stat label="Author">
          <span className="font-mono">
            {article.permit.author.slice(0, 6)}…{article.permit.author.slice(-4)}
          </span>
        </Stat>
        <Stat label="Royalty split">95% / 5%</Stat>
      </div>

      <div className="mt-5">
        <div className="text-[10px] uppercase tracking-wider text-base-500">Mint on</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {mintableChains.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={() => setSelectedChainId(c.id)}
              className={`rounded-md px-3 py-1.5 text-sm ring-1 ring-inset ${
                selectedChainId === c.id
                  ? 'bg-base-500 text-white ring-base-500'
                  : 'bg-white text-base-700 ring-base-100 hover:bg-base-50'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div className="text-xs text-base-500">
          {!isConnected
            ? 'Connect wallet to mint.'
            : !selectedChain
            ? 'Pick a chain.'
            : activeChainId !== selectedChain.id
            ? `Will switch to ${selectedChain.name} on click.`
            : `Active: ${selectedChain.name}`}
        </div>
        <button
          type="button"
          disabled={!isConnected || !selectedChain || writing || confirming || switching}
          onClick={onMint}
          className="rounded-md bg-base-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-base-600 disabled:opacity-50"
        >
          {writing
            ? 'Confirm in wallet…'
            : confirming
            ? 'Mining…'
            : confirmed
            ? 'Minted ✓ — mint another'
            : 'Mint'}
        </button>
      </div>

      {errorMsg && <p className="mt-3 text-xs text-red-600">{errorMsg}</p>}
      {confirmed && txHash && selectedChain && (
        <p className="mt-3 text-xs text-emerald-700">
          Mint confirmed.{' '}
          <a
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
            href={`${selectedChain.blockExplorers.default.url}/tx/${txHash}`}
          >
            View transaction
          </a>
        </p>
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-base-400">{label}</div>
      <div className="text-base-700">{children}</div>
    </div>
  );
}
