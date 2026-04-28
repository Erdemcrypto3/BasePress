'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignMessage } from '@basepress/wallet';
import { siweNonce, siweVerify, type SiweSession } from './api';

export type SiweState = {
  session: SiweSession | null;
  busy: boolean;
  error: string | null;
  isConnected: boolean;
  address: `0x${string}` | undefined;
  signIn: () => Promise<void>;
  signOut: () => void;
};

export function useSiweSession(): SiweState {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<SiweSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drop the session whenever the connected wallet changes.
  useEffect(() => {
    setSession(null);
    setError(null);
  }, [address]);

  // Auto-clear when the session expires (Worker enforces 5-min TTL anyway).
  useEffect(() => {
    if (!session) return;
    const ms = session.expiresAt * 1000 - Date.now();
    if (ms <= 0) {
      setSession(null);
      return;
    }
    const t = setTimeout(() => setSession(null), ms);
    return () => clearTimeout(t);
  }, [session]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const { message } = await siweNonce(address as `0x${string}`);
      const signature = await signMessageAsync({ message });
      const s = await siweVerify(message, signature);
      setSession(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [address, signMessageAsync]);

  const signOut = useCallback(() => {
    setSession(null);
    setError(null);
  }, []);

  return {
    session,
    busy,
    error,
    isConnected,
    address: address as `0x${string}` | undefined,
    signIn,
    signOut,
  };
}
