'use client';

import { useEffect, useState } from 'react';
import { fetchArticles, toggleArticleVisibility, type ArticleListItem, type SiweSession } from '../../lib/api';
import { SUPPORTED_CHAINS } from '@basepress/chain';
import { MINT_PRICE } from '../../lib/contract';
import { MintCount } from '../../components/MintCount';

type Props = { refreshKey: number; session: SiweSession };

export function AdminDashboard({ refreshKey, session }: Props) {
  const [items, setItems] = useState<ArticleListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    fetchArticles(session.token)
      .then((r) => {
        if (!cancelled) setItems(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, session.token]);

  async function handleToggle(article: ArticleListItem) {
    const newHidden = !article.hidden;
    setToggling(article.articleId);
    try {
      await toggleArticleVisibility(session.token, article.articleId, newHidden);
      setItems((prev) =>
        prev?.map((a) => (a.articleId === article.articleId ? { ...a, hidden: newHidden } : a)) ?? null,
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to toggle visibility');
    } finally {
      setToggling(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-xl bg-amber-50 p-6 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
        Could not load articles ({error}).
      </div>
    );
  }
  if (!items) {
    return <div className="text-sm text-base-500">Loading…</div>;
  }
  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-white p-8 text-center ring-1 ring-inset ring-base-100 shadow-sm">
        <div className="text-sm text-base-500">No articles published yet.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((a) => {
        const chains = a.signatures
          .map((s) => SUPPORTED_CHAINS.find((c) => c.id === s.chainId)?.name ?? `chain ${s.chainId}`)
          .join(' · ');
        // Refs: P001-PAI-0051 — V4 price is a fixed contract constant for every article.
        const priceEth = `${MINT_PRICE} ETH`;
        const isToggling = toggling === a.articleId;
        return (
          <article
            key={a.articleId}
            className={`rounded-xl p-5 ring-1 ring-inset shadow-sm ${
              a.hidden
                ? 'bg-base-50 ring-base-200 opacity-75'
                : 'bg-white ring-base-100'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <a
                  href={`/article/?id=${a.articleId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-base font-semibold text-base-900 underline decoration-base-200 hover:decoration-base-500"
                >
                  {a.title}
                </a>
                {a.hidden && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200">
                    Hidden
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isToggling}
                  onClick={() => handleToggle(a)}
                  className={`rounded-md px-3 py-1 text-xs font-medium ring-1 ring-inset disabled:opacity-50 ${
                    a.hidden
                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
                      : 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100'
                  }`}
                >
                  {isToggling ? '…' : a.hidden ? 'Show' : 'Hide'}
                </button>
                <span className="rounded-full bg-base-50 px-2 py-1 text-xs font-mono text-base-700 ring-1 ring-inset ring-base-100">
                  /{a.slug}
                </span>
              </div>
            </div>
            {a.description && (
              <p className="mt-1 text-sm text-base-700">{a.description}</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-base-500 sm:grid-cols-5">
              <Stat label="Price">{priceEth}</Stat>
              <Stat label="Max supply">∞</Stat>
              <Stat label="Mints">
                <MintCount articleId={a.articleId} />
              </Stat>
              <Stat label="Chains">{chains}</Stat>
              <Stat label="Published">
                {new Date(a.publishedAt * 1000).toLocaleDateString()}
              </Stat>
            </div>
            <div className="mt-3 font-mono text-[10px] text-base-400 break-all">
              {a.articleId}
            </div>
          </article>
        );
      })}
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
