'use client';

import { useState } from 'react';
import { ConnectButton } from '@basepress/wallet';
import { isAdminAddress } from '../lib/admin';
import { useSiweSession } from '../lib/siwe';
import { WriteArticle } from './components/WriteArticle';
import { AdminDashboard } from './components/AdminDashboard';
import { WithdrawPanel } from './components/WithdrawPanel';
import { TagManager } from './components/TagManager';

export default function AdminPage() {
  const { session, busy, error, isConnected, address, signIn, signOut } = useSiweSession();
  const [tab, setTab] = useState<'write' | 'list' | 'tags' | 'withdraw'>('write');
  const [refreshKey, setRefreshKey] = useState(0);

  const isAdmin = isAdminAddress(address);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:py-16">
      <header className="mb-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-base-900">
            BasePress · Admin
          </h1>
          <p className="mt-2 text-sm text-base-700">
            Publish articles off-chain. Readers mint on whichever chain they prefer.
          </p>
        </div>
        <ConnectButton showBalance={false} />
      </header>

      {!isConnected && (
        <Card>
          <p className="text-sm text-base-700">Connect a wallet to continue.</p>
        </Card>
      )}

      {isConnected && !isAdmin && (
        <Card tone="warn">
          <p className="text-sm">
            Connected wallet <Mono>{address}</Mono> is not on the admin allow-list.
          </p>
          <p className="mt-2 text-xs text-base-500">
            Allow-list is configured at build time via <Mono>NEXT_PUBLIC_ADMIN_WALLETS</Mono>.
          </p>
        </Card>
      )}

      {isConnected && isAdmin && !session && (
        <Card>
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-semibold text-base-900">Sign in</h2>
              <p className="mt-1 text-xs text-base-500">
                Sign a SIWE message so the API trusts your publish requests for the next hour.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={signIn}
              className="self-start rounded-md bg-base-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-base-600 disabled:opacity-50"
            >
              {busy ? 'Awaiting signature…' : 'Sign in with Ethereum'}
            </button>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        </Card>
      )}

      {isConnected && isAdmin && session && (
        <>
          <div className="mb-6 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 ring-1 ring-inset ring-emerald-200">
            <div className="text-xs text-emerald-800">
              Signed in as <Mono>{session.address}</Mono> · session expires{' '}
              {new Date(session.expiresAt * 1000).toLocaleTimeString()}
            </div>
            <button
              type="button"
              onClick={signOut}
              className="text-xs font-medium text-emerald-800 underline hover:text-emerald-900"
            >
              Sign out
            </button>
          </div>

          <nav className="mb-6 flex gap-2 text-sm">
            <TabButton active={tab === 'write'} onClick={() => setTab('write')}>
              Write
            </TabButton>
            <TabButton active={tab === 'list'} onClick={() => setTab('list')}>
              Published
            </TabButton>
            <TabButton active={tab === 'tags'} onClick={() => setTab('tags')}>
              Tags
            </TabButton>
            <TabButton active={tab === 'withdraw'} onClick={() => setTab('withdraw')}>
              Withdraw
            </TabButton>
          </nav>

          {tab === 'write' && (
            <WriteArticle
              session={session}
              onPublished={() => {
                setRefreshKey((k) => k + 1);
                setTab('list');
              }}
            />
          )}
          {tab === 'list' && <AdminDashboard refreshKey={refreshKey} session={session} />}
          {tab === 'tags' && <TagManager session={session} />}
          {tab === 'withdraw' && <WithdrawPanel />}
        </>
      )}
    </main>
  );
}

function Card({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'warn';
}) {
  const cls =
    tone === 'warn'
      ? 'rounded-xl bg-amber-50 p-6 ring-1 ring-inset ring-amber-200 text-amber-900'
      : 'rounded-xl bg-white p-6 ring-1 ring-inset ring-base-100 shadow-sm';
  return <div className={cls}>{children}</div>;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
        active
          ? 'bg-base-500 text-white ring-base-500'
          : 'bg-white text-base-700 ring-base-100 hover:bg-base-50'
      }`}
    >
      {children}
    </button>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs">{children}</span>;
}
