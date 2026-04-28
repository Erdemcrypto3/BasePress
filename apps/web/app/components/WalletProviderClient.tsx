'use client';

import dynamic from 'next/dynamic';

// wagmi's storage layer touches indexedDB at module-init, which crashes
// Next's static export prerender. Loading the provider with ssr:false
// keeps the wallet stack purely client-side without abandoning `output:'export'`.
export const ClientWalletProvider = dynamic(
  () => import('@basepress/wallet').then((m) => m.BasePressWalletProvider),
  { ssr: false },
);
