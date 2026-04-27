import { base } from 'viem/chains';
import { defineChain } from 'viem';

export const ink = defineChain({
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc-gel.inkonchain.com', 'https://rpc-qnd.inkonchain.com'],
      webSocket: ['wss://rpc-gel.inkonchain.com', 'wss://rpc-qnd.inkonchain.com'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://explorer.inkonchain.com',
      apiUrl: 'https://explorer.inkonchain.com/api',
    },
  },
  testnet: false,
});

export { base };

// Single source of truth for the chain registry. Add a new EVM chain here
// and the rest of the monorepo (wallet provider, contract resolver, frontend
// chain switcher) picks it up automatically.
export const SUPPORTED_CHAINS = [base, ink] as const;

export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];
export type SupportedChainId = SupportedChain['id'];

export function getChainById(id: number): SupportedChain | undefined {
  return SUPPORTED_CHAINS.find((c) => c.id === id);
}

export type { PublicClient } from 'viem';
