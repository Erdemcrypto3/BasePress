'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignMessage } from '@basepress/wallet';
import { siweNonce, siweVerify, siweLogout, type SiweSession } from './api';

const STORAGE_KEY = 'basepress:siwe';

// Persist the SIWE session across page reloads. Token already has a Worker-side
// TTL (PAI-0004); localStorage is a UX cache, not a security boundary.
export function loadSession(): SiweSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SiweSession;
    if (s.expiresAt * 1000 <= Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function saveSession(s: SiweSession) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota or disabled storage — silent */
  }
}

function clearSession() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* silent */
  }
}

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

  // Hydrate from localStorage on mount.
  useEffect(() => {
    const s = loadSession();
    if (s) setSession(s);
  }, []);

  // Drop the session whenever the connected wallet changes.
  useEffect(() => {
    setSession(null);
    setError(null);
    clearSession();
  }, [address]);

  // Auto-clear when the session expires.
  useEffect(() => {
    if (!session) return;
    const ms = session.expiresAt * 1000 - Date.now();
    if (ms <= 0) {
      setSession(null);
      clearSession();
      return;
    }
    const t = setTimeout(() => {
      setSession(null);
      clearSession();
    }, ms);
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
      saveSession(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [address, signMessageAsync]);

  // P001-PAI-0033: revoke KV session server-side before clearing local state
  const signOut = useCallback(() => {
    if (session?.token) {
      siweLogout(session.token); // fire-and-forget; local state clears regardless
    }
    setSession(null);
    setError(null);
    clearSession();
  }, [session]);

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
