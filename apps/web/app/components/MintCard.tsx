'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatEther, parseEther } from 'viem';
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
import { BASEPRESS_ABI, MINT_PRICE, getContractAddress } from '../lib/contract';

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

  // Refs: P001-PAI-0051 — V4 mint price is a contract constant, supply unlimited.
  const priceWei = useMemo(() => parseEther(MINT_PRICE.toString()), []);

  // On-chain reads — supply minted so far on the selected chain.
  const { data: mintedSoFar, refetch: refetchSupply } = useReadContract({
    abi: BASEPRESS_ABI,
    address: (contract ?? undefined) as `0x${string}` | undefined,
    chainId: selectedChain?.id,
    functionName: 'articleSupply',
    args: [article.articleId],
    query: { enabled: !!contract && !!selectedChain },
  });

  const { data: platformFeeBps } = useReadContract({
    abi: BASEPRESS_ABI,
    address: (contract ?? undefined) as `0x${string}` | undefined,
    chainId: selectedChain?.id,
    functionName: 'platformFeeBps',
    query: { enabled: !!contract && !!selectedChain },
  });
  const splitLabel = useMemo(() => {
    if (typeof platformFeeBps !== 'bigint' && typeof platformFeeBps !== 'number') return '— author / — platform';
    const feePct = Number(platformFeeBps) / 100;
    const authorPct = 100 - feePct;
    const fmt = (n: number) => (Number.isInteger(n) ? n.toString() : n.toFixed(2));
    return `${fmt(authorPct)}% author / ${fmt(feePct)}% platform`;
  }, [platformFeeBps]);

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
    pollingInterval: 3_000,
    confirmations: 1,
  });

  const [confirmTimeout, setConfirmTimeout] = useState(false);
  useEffect(() => {
    if (!confirming) { setConfirmTimeout(false); return; }
    const t = setTimeout(() => setConfirmTimeout(true), 20_000);
    return () => clearTimeout(t);
  }, [confirming]);

  useEffect(() => {
    if (confirmed) { refetchSupply(); setConfirmTimeout(false); }
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
          author: article.permit.author,
          deadline: BigInt(article.permit.deadline || 0),
        },
        signatureForChain,
      ],
      value: priceWei,
    });
  };

  const supplyLabel = (() => {
    if (mintedSoFar === undefined) return '—';
    return `${mintedSoFar.toString()} / ∞`;
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
        <h3 className="text-base font-semibold text-base-900">Collect this article</h3>
        <span className="text-sm font-medium text-base-900">{formatEther(priceWei)} ETH</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
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

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-base-500">
          {!isConnected
            ? 'Connect wallet to mint.'
            : !selectedChain
            ? 'Pick a chain.'
            : activeChainId !== selectedChain.id
            ? `Will switch to ${selectedChain.name} on click.`
            : `Minted: ${supplyLabel}`}
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
            ? 'Minting…'
            : confirmed
            ? 'Minted — collect again'
            : 'Mint'}
        </button>
      </div>

      {errorMsg && <p className="mt-3 text-xs text-red-600">{errorMsg}</p>}
      {confirming && confirmTimeout && txHash && selectedChain && (
        <div className="mt-3 flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          <span>
            Taking longer than expected.{' '}
            <a
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
              href={`${selectedChain.blockExplorers.default.url}/tx/${txHash}`}
            >
              Check on explorer
            </a>
          </span>
          <button
            type="button"
            onClick={() => { resetWrite(); refetchSupply(); }}
            className="ml-3 font-medium underline"
          >
            Reset
          </button>
        </div>
      )}
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

      <details className="mt-4">
        <summary className="cursor-pointer select-none text-xs text-base-400 hover:text-base-600">
          Details
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Stat label="Price">{formatEther(priceWei)} ETH</Stat>
          <Stat label="Minted">{supplyLabel}</Stat>
          <Stat label="Author">
            <span className="font-mono">
              {article.permit.author.slice(0, 6)}…{article.permit.author.slice(-4)}
            </span>
          </Stat>
          <Stat label="Split">{splitLabel}</Stat>
        </div>
        {selectedChain && contract && (
          <div className="mt-3 text-xs text-base-500">
            Contract:{' '}
            <a
              href={`${selectedChain.blockExplorers.default.url}/address/${contract}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono underline hover:text-base-700"
            >
              {contract.slice(0, 10)}…{contract.slice(-8)}
            </a>
            <span className="ml-2">· ERC-1155 · EIP-712 permit</span>
          </div>
        )}
      </details>
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
