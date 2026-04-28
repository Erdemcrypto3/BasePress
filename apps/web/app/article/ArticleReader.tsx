'use client';

import { useEffect, useMemo, useState } from 'react';
import { ConnectButton } from '@basepress/wallet';
import { ClientWalletProvider } from '../components/WalletProviderClient';
import { fetchArticle, fetchArticleContent, type ArticleListItem } from '../lib/api';
import { sanitizeHtml } from '../lib/sanitize';
import { MintCard } from '../components/MintCard';

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
    fetchArticleContent(article.permit.contentURI)
      .then((raw) => setHtml(sanitizeHtml(raw)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [article.permit.contentURI]);

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
  const [article, setArticle] = useState<ArticleListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchArticle(articleId)
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

          <hr className="my-8 border-base-100" />

          <ArticleBody article={article} />

          <div className="mt-10">
            <MintCard article={article} />
          </div>

          <footer className="mt-16 border-t border-base-100 pt-8 text-xs text-base-500">
            BasePress · multichain by design · MIT license
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
