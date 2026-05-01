import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  metaMaskWallet,
  rabbyWallet,
  coinbaseWallet,
  walletConnectWallet,
  injectedWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http, fallback } from 'wagmi';
import { SUPPORTED_CHAINS, base, ink } from '@basepress/chain';

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Popular',
      wallets: [metaMaskWallet, rabbyWallet, coinbaseWallet, walletConnectWallet, injectedWallet],
    },
  ],
  {
    appName: 'BasePress',
    projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || '0',
  },
);

export const walletConfig = createConfig({
  connectors,
  chains: SUPPORTED_CHAINS,
  transports: {
    [base.id]: fallback([
      http('https://base-rpc.publicnode.com'),
      http('https://base.gateway.tenderly.co'),
      http('https://base.meowrpc.com'),
    ]),
    [ink.id]: fallback([
      http('https://rpc-gel.inkonchain.com'),
      http('https://rpc-qnd.inkonchain.com'),
    ]),
  },
  batch: { multicall: false },
  ssr: false,
});
