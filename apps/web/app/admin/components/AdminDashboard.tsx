'use client';

import { useEffect, useState } from 'react';
import { fetchArticles, type ArticleListItem } from '../../lib/api';
import { SUPPORTED_CHAINS } from '@basepress/chain';

type Props = { refreshKey: number };

export function AdminDashboard({ refreshKey }: Props) {
  const [items, setItems] = useState<ArticleListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    fetchArticles()
      .then((r) => {
        if (!cancelled) setItems(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

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
        const priceEth = (() => {
          try {
            return `${(Number(a.permit.price) / 1e18).toFixed(4)} ETH`;
          } catch {
            return '—';
          }
        })();
        return (
          <article
            key={a.articleId}
            className="rounded-xl bg-white p-5 ring-1 ring-inset ring-base-100 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-base-900">{a.title}</h3>
                {a.description && (
                  <p className="mt-1 text-sm text-base-700">{a.description}</p>
                )}
              </div>
              <span className="rounded-full bg-base-50 px-2 py-1 text-xs font-mono text-base-700 ring-1 ring-inset ring-base-100">
                /{a.slug}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-base-500 sm:grid-cols-4">
              <Stat label="Price">{priceEth}</Stat>
              <Stat label="Max supply">
                {a.permit.maxSupply === '0' ? '∞' : a.permit.maxSupply}
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
