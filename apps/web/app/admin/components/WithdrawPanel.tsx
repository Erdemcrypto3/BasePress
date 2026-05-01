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
import { SUPPORTED_CHAINS, type SupportedChain } from '@basepress/chain';
import { BASEPRESS_ABI, getContractAddress } from '../../lib/contract';

export function WithdrawPanel() {
  const { address, isConnected } = useAccount();

  const deployedChains = useMemo(
    () => SUPPORTED_CHAINS.filter((c) => getContractAddress(c.id) !== null),
    [],
  );

  if (!isConnected || !address) {
    return (
      <div className="rounded-xl bg-white p-6 ring-1 ring-inset ring-base-100 shadow-sm">
        <p className="text-sm text-base-700">Connect a wallet to view withdraw balances.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-5 ring-1 ring-inset ring-base-100 shadow-sm">
        <h3 className="text-base font-semibold text-base-900">Withdraw earnings</h3>
        <p className="mt-1 text-xs text-base-500">
          Author balances accrue when readers mint your articles. Platform balance is the
          on-chain platform fee and can be claimed by anyone — funds always go to the on-chain
          platformTreasury.
        </p>
      </div>

      {deployedChains.map((chain) => (
        <ChainRow key={chain.id} chain={chain} authorAddress={address as `0x${string}`} />
      ))}
    </div>
  );
}

function ChainRow({
  chain,
  authorAddress,
}: {
  chain: SupportedChain;
  authorAddress: `0x${string}`;
}) {
  const contract = getContractAddress(chain.id) as `0x${string}` | null;
  const activeChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const baseRead = {
    abi: BASEPRESS_ABI,
    address: (contract ?? undefined) as `0x${string}` | undefined,
    chainId: chain.id,
    query: { enabled: !!contract },
  } as const;

  const { data: authorBal, refetch: refetchAuthor, error: authorErr } = useReadContract({
    ...baseRead,
    functionName: 'authorBalances',
    args: [authorAddress],
  });
  const { data: platformBal, refetch: refetchPlatform, error: platformErr } = useReadContract({
    ...baseRead,
    functionName: 'platformBalance',
  });
  const { data: ownerAddr } = useReadContract({
    ...baseRead,
    functionName: 'owner',
  });
  const { data: treasuryAddr } = useReadContract({
    ...baseRead,
    functionName: 'platformTreasury',
  });

  const readError = authorErr || platformErr;
  useEffect(() => {
    if (readError) console.error(`[WithdrawPanel ${chain.name}]`, readError);
  }, [readError, chain.name]);

  const isOwner =
    ownerAddr && authorAddress
      ? (ownerAddr as string).toLowerCase() === authorAddress.toLowerCase()
      : false;

  const [pending, setPending] = useState<'author' | 'platform' | null>(null);
  const { writeContract, data: txHash, isPending: writing, reset, error } = useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: chain.id,
    pollingInterval: 3_000,
    confirmations: 1,
  });

  useEffect(() => {
    if (confirmed) {
      refetchAuthor();
      refetchPlatform();
      setTimeout(() => { refetchAuthor(); refetchPlatform(); }, 2_000);
      setPending(null);
    }
  }, [confirmed, refetchAuthor, refetchPlatform]);

  useEffect(() => {
    if (!confirming) return;
    const t = setInterval(() => { refetchAuthor(); refetchPlatform(); }, 4_000);
    return () => clearInterval(t);
  }, [confirming, refetchAuthor, refetchPlatform]);

  const ensureChain = async () => {
    if (activeChainId !== chain.id) {
      await switchChainAsync({ chainId: chain.id });
    }
  };

  const onWithdrawAuthor = async () => {
    if (!contract) return;
    await ensureChain();
    reset();
    setPending('author');
    writeContract({
      abi: BASEPRESS_ABI,
      address: contract,
      chainId: chain.id,
      functionName: 'withdrawAuthor',
    });
  };

  const onWithdrawPlatform = async () => {
    if (!contract) return;
    await ensureChain();
    reset();
    setPending('platform');
    writeContract({
      abi: BASEPRESS_ABI,
      address: contract,
      chainId: chain.id,
      functionName: 'withdrawPlatform',
    });
  };

  const errorMsg = error
    ? ((error as Error & { shortMessage?: string }).shortMessage ?? error.message)
    : null;

  const authorEth = authorBal !== undefined ? formatEther(authorBal as bigint) : '—';
  const platformEth = platformBal !== undefined ? formatEther(platformBal as bigint) : '—';

  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-inset ring-base-100 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-base-900">{chain.name}</h4>
          {contract && (
            <a
              href={`${chain.blockExplorers.default.url}/address/${contract}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] text-base-500 underline hover:text-base-700"
            >
              {contract.slice(0, 10)}…{contract.slice(-8)}
            </a>
          )}
        </div>
        {treasuryAddr && (
          <div className="text-right text-[10px] text-base-500">
            <div className="uppercase tracking-wider text-base-400">Treasury</div>
            <div className="font-mono">
              {(treasuryAddr as string).slice(0, 6)}…{(treasuryAddr as string).slice(-4)}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Slot
          title="Your author balance"
          eth={authorEth}
          buttonLabel={
            pending === 'author' && writing
              ? 'Confirm in wallet…'
              : pending === 'author' && confirming
              ? 'Confirming…'
              : 'Withdraw'
          }
          disabled={
            !contract ||
            writing ||
            confirming ||
            authorBal === undefined ||
            (authorBal as bigint) === 0n
          }
          onClick={onWithdrawAuthor}
        />
        <Slot
          title={`Platform balance${isOwner ? ' (owner)' : ''}`}
          eth={platformEth}
          buttonLabel={
            pending === 'platform' && writing
              ? 'Confirm in wallet…'
              : pending === 'platform' && confirming
              ? 'Confirming…'
              : 'Sweep to treasury'
          }
          disabled={
            !contract ||
            writing ||
            confirming ||
            platformBal === undefined ||
            (platformBal as bigint) === 0n
          }
          onClick={onWithdrawPlatform}
        />
      </div>

      {readError && (
        <p className="mt-3 text-xs text-red-600">
          {chain.name} read error: {readError.message?.slice(0, 150)}
        </p>
      )}
      {errorMsg && pending && (
        <p className="mt-3 text-xs text-red-600">
          {chain.name} — {errorMsg}
        </p>
      )}
      {confirmed && txHash && pending === null && (
        <p className="mt-3 text-xs text-emerald-700">
          Confirmed.{' '}
          <a
            target="_blank"
            rel="noopener noreferrer"
            href={`${chain.blockExplorers.default.url}/tx/${txHash}`}
            className="underline"
          >
            View transaction
          </a>
        </p>
      )}
    </div>
  );
}

function Slot({
  title,
  eth,
  buttonLabel,
  disabled,
  onClick,
}: {
  title: string;
  eth: string;
  buttonLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="rounded-md bg-base-50 p-4 ring-1 ring-inset ring-base-100">
      <div className="text-[10px] uppercase tracking-wider text-base-500">{title}</div>
      <div className="mt-1 text-base font-semibold text-base-900">{eth} ETH</div>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="mt-3 rounded-md bg-base-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-base-600 disabled:opacity-40"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
