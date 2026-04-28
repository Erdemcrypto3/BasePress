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
    <header className="mb-10 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-base-900 sm:text-4xl">
          BasePress
        </h1>
        <p className="mt-2 text-sm text-base-700">
          Multichain decentralized blog. Read free, mint on any chain.
        </p>
        {isConnected && (
          <span
            className={`mt-3 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
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
    </header>
  );
}

function ChainSummary() {
  const chainId = useChainId();
  const active = SUPPORTED_CHAINS.find((c) => c.id === chainId);
  const contract = active ? getContractAddress(active.id) : null;

  return (
    <div className="mb-8 rounded-xl bg-white p-5 ring-1 ring-inset ring-base-100 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-base-500">
        Active chain
      </div>
      <div className="mt-1 text-base-900">
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
    </div>
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
      <ChainSummary />
      <ArticleFeed />
      <footer className="mt-16 border-t border-base-100 pt-8 text-xs text-base-500">
        BasePress · multichain by design · MIT license
      </footer>
    </main>
  );
}

export default function HomePage() {
  return (
    <ClientWalletProvider>
      <HomeContent />
    </ClientWalletProvider>
  );
}
