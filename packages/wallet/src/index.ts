export { walletConfig } from './config';
export { BasePressWalletProvider } from './provider';

export {
  useAccount,
  useConnect,
  useDisconnect,
  useBalance,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract,
  useReadContract,
  useSwitchChain,
  useChainId,
  useSignTypedData,
  useSignMessage,
} from 'wagmi';

export { ConnectButton } from '@rainbow-me/rainbowkit';
