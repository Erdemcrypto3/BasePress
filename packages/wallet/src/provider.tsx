'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { walletConfig } from './config';

import '@rainbow-me/rainbowkit/styles.css';

const queryClient = new QueryClient();

const theme = lightTheme({
  accentColor: '#0052FF',
  accentColorForeground: 'white',
  borderRadius: 'medium',
});

export function BasePressWalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={walletConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
