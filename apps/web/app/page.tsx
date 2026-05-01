'use client';

import { useEffect, useState } from 'react';
import { ConnectButton, useAccount, useChainId } from '@basepress/wallet';
import { SUPPORTED_CHAINS } from '@basepress/chain';
import { isAdminAddress } from './lib/admin';
import { fetchArticles, type ArticleListItem } from './lib/api';
import { getContractAddress } from './lib/contract';
import { ClientWalletProvider } from './components/WalletProviderClient';

function Header() {
  const { address, isConnected } = useAccount();
  const isAdmin = isAdminAddress(address);

  return (
    <header className="mb-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-base-900 sm:text-4xl">
            BasePress
          </h1>
          {isConnected && (
            <span
              className={`mt-2 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                isAdmin
                  ? 'bg-emerald-100 text-emerald-700 ring-emerald-300'
                  : 'bg-base-100 text-base-700 ring-base-200'
              }`}
            >
              {isAdmin ? 'Admin' : 'Reader'}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <ConnectButton showBalance={false} />
          {isAdmin && (
            <a
              href="/admin"
              className="rounded-md bg-base-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-base-600"
            >
              Admin →
            </a>
          )}
        </div>
      </div>
      <p className="mt-4 max-w-lg text-base text-base-600">
        Decentralized articles on Base &amp; Ink. Authors publish off-chain with EIP-712
        permits — readers collect on whichever chain they prefer. No gas to publish, no
        platform lock-in.
      </p>
    </header>
  );
}

function NetworkDetails() {
  const chainId = useChainId();
  const active = SUPPORTED_CHAINS.find((c) => c.id === chainId);
  const contract = active ? getContractAddress(active.id) : null;

  return (
    <details className="mb-8 rounded-xl bg-white ring-1 ring-inset ring-base-100 shadow-sm">
      <summary className="cursor-pointer select-none px-5 py-4 text-xs font-semibold uppercase tracking-wider text-base-500 hover:text-base-700">
        Network &amp; contracts
      </summary>
      <div className="border-t border-base-100 px-5 py-4 text-sm">
        <div className="text-base-900">
          {active ? `${active.name} (${active.id})` : 'Unsupported chain — switch in wallet'}
        </div>
        {active && (
          <div className="mt-2 text-xs text-base-500">
            Contract:{' '}
            {contract ? (
              <a
                href={`${active.blockExplorers.default.url}/address/${contract}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono underline hover:text-base-700"
              >
                {contract.slice(0, 10)}...{contract.slice(-8)}
              </a>
            ) : (
              <span className="text-amber-600">not yet deployed</span>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {SUPPORTED_CHAINS.map((c) => {
            const addr = getContractAddress(c.id);
            if (!addr) return null;
            return (
              <a
                key={c.id}
                href={`${c.blockExplorers.default.url}/address/${addr}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-base-500 underline hover:text-base-700"
              >
                {c.name} contract
              </a>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function ArticleFeed() {
  const [articles, setArticles] = useState<ArticleListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchArticles().then(setArticles).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="rounded-xl bg-amber-50 p-6 ring-1 ring-inset ring-amber-200 text-sm text-amber-800">
        Could not load articles ({error}). The API may not be deployed yet.
      </div>
    );
  }
  if (!articles) {
    return <div className="text-sm text-base-500">Loading...</div>;
  }
  if (articles.length === 0) {
    return (
      <div className="rounded-xl bg-white p-8 text-center ring-1 ring-inset ring-base-100 shadow-sm">
        <div className="text-2xl mb-2">No articles yet</div>
        <p className="text-sm text-base-500">Once an admin publishes, articles appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {articles.map((a) => (
        <a
          key={a.articleId}
          href={`/article/?id=${a.articleId}`}
          className="block rounded-xl bg-white p-5 ring-1 ring-inset ring-base-100 shadow-sm transition hover:ring-base-300"
        >
          <div className="flex gap-4">
            {a.coverImage && (
              <img
                src={a.coverImage}
                alt=""
                className="h-20 w-20 flex-none rounded-md object-cover ring-1 ring-inset ring-base-100"
              />
            )}
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-base-900">{a.title}</h3>
              {a.description && (
                <p className="mt-1 text-sm text-base-700 line-clamp-2">{a.description}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-base-500">
                <span className="font-mono">
                  {a.author.slice(0, 6)}...{a.author.slice(-4)}
                </span>
                <span>{new Date(a.publishedAt * 1000).toLocaleDateString()}</span>
                {a.tags.slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-base-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-base-700 ring-1 ring-inset ring-base-100"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

function HomeContent() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:py-16">
      <Header />
      <NetworkDetails />
      <ArticleFeed />
      <Footer />
    </main>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-base-100 pt-8 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-6 text-xs text-base-500">
        <div className="space-y-2">
          <p className="font-medium text-base-700">BasePress</p>
          <p>Multichain decentralized blog · MIT license</p>
          <div className="flex flex-wrap gap-3">
            {SUPPORTED_CHAINS.map((c) => {
              const addr = getContractAddress(c.id);
              if (!addr) return null;
              return (
                <a
                  key={c.id}
                  href={`${c.blockExplorers.default.url}/address/${addr}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-base-700"
                >
                  {c.name}
                </a>
              );
            })}
          </div>
        </div>
        <div className="flex gap-4">
          <a
            href="https://github.com/Erdemcrypto3/BasePress"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-base-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-base-700"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
            </svg>
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function HomePage() {
  return (
    <ClientWalletProvider>
      <HomeContent />
    </ClientWalletProvider>
  );
}
