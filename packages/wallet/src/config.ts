import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { SUPPORTED_CHAINS } from '@basepress/chain';

export const walletConfig = getDefaultConfig({
  appName: 'BasePress',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || '0',
  chains: SUPPORTED_CHAINS,
  ssr: false,
});
