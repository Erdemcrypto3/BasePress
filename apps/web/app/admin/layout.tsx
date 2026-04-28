'use client';

import { ClientWalletProvider } from '../components/WalletProviderClient';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <ClientWalletProvider>{children}</ClientWalletProvider>;
}
