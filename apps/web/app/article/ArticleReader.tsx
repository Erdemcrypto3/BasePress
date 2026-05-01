'use client';

import { useEffect, useMemo, useState } from 'react';
import { ConnectButton, useAccount } from '@basepress/wallet';
import { ClientWalletProvider } from '../components/WalletProviderClient';
import { isAdminAddress } from '../lib/admin';
import { SUPPORTED_CHAINS } from '@basepress/chain';
import { getContractAddress } from '../lib/contract';
import { fetchArticle, fetchArticleContent, type ArticleListItem } from '../lib/api';
import { loadSession } from '../lib/siwe';
import { sanitizeHtml } from '../lib/sanitize';
import { MintCard } from '../components/MintCard';
import { MintCount } from '../components/MintCount';

function useArticleIdFromQuery(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setId(q.get('id'));
  }, []);
  return id;
}

function ArticleBody({ article }: { article: ArticleListItem }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // PAI-0016: fetch from canonical contentKey, never from admin-controlled permit.contentURI
    fetchArticleContent(article.contentKey)
      .then((raw) => setHtml(sanitizeHtml(raw)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [article.contentKey]);

  if (error) {
    return (
      <div className="rounded-xl bg-amber-50 p-6 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
        Could not load article body ({error}).
      </div>
    );
  }
  if (html === null) {
    return <div className="text-sm text-base-500">Loading body…</div>;
  }
  return (
    <div
      className="prose prose-base max-w-none text-base-900"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ReaderContent({ articleId }: { articleId: string }) {
  const { address } = useAccount();
  const isAdmin = isAdminAddress(address);
  const [article, setArticle] = useState<ArticleListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = loadSession()?.token;
    fetchArticle(articleId, token ?? undefined)
      .then(setArticle)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [articleId]);

  const publishedDate = useMemo(
    () => (article ? new Date(article.publishedAt * 1000).toLocaleDateString() : ''),
    [article],
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:py-16">
      <header className="mb-8 flex items-start justify-between gap-4">
        <a href="/" className="text-xs text-base-500 underline hover:text-base-700">
          ← BasePress
        </a>
        <ConnectButton showBalance={false} />
      </header>

      {error && (
        <div className="rounded-xl bg-amber-50 p-6 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
          Could not load article ({error}).
        </div>
      )}

      {!article && !error && <div className="text-sm text-base-500">Loading…</div>}

      {article && (
        <>
          {article.coverImage && (
            <img
              src={article.coverImage}
              alt=""
              className="mb-6 w-full rounded-xl object-cover ring-1 ring-inset ring-base-100"
            />
          )}
          <h1 className="text-3xl font-semibold tracking-tight text-base-900 sm:text-4xl">
            {article.title}
          </h1>
          {article.description && (
            <p className="mt-2 text-base text-base-700">{article.description}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-base-500">
            <span className="font-mono">
              {article.author.slice(0, 6)}…{article.author.slice(-4)}
            </span>
            <span>{publishedDate}</span>
            {article.tags.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {article.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-base-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-base-700 ring-1 ring-inset ring-base-100"
                  >
                    {t}
                  </span>
                ))}
              </span>
            )}
          </div>

          <div className="mt-4 text-xs text-base-400">
            Collected: <MintCount articleId={article.articleId} />
          </div>

          <hr className="my-8 border-base-100" />

          <ArticleBody article={article} />

          {!isAdmin && (
            <div className="mt-16 border-t border-base-100 pt-8">
              <p className="mb-4 text-center text-sm text-base-500">
                Enjoyed this article? Collect it as an NFT.
              </p>
              <MintCard article={article} />
            </div>
          )}

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
          </footer>
        </>
      )}
    </main>
  );
}

export function ArticleReader() {
  const articleId = useArticleIdFromQuery();
  return (
    <ClientWalletProvider>
      {articleId ? (
        <ReaderContent articleId={articleId} />
      ) : (
        <main className="mx-auto max-w-3xl px-6 py-16">
          <p className="text-sm text-base-500">
            Missing article id. Go back to <a href="/" className="underline">the index</a>.
          </p>
        </main>
      )}
    </ClientWalletProvider>
  );
}
