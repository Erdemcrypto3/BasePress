// PAI-0030: KV-backed admin allowlist with audit trail.
// Bootstraps from the comma-separated `ADMIN_ADDRESSES` env on first read so
// existing deployments keep working; once any admin CRUD endpoint is invoked
// the KV list becomes authoritative and the env var is ignored.

import type { Env } from '../index';

const ADMIN_LIST_KEY = 'admins:list';

type AdminRecord = {
  addresses: string[]; // lowercase 0x-addresses
  updatedAt: number;
  updatedBy: string | null;
};

function normalize(addr: string): string {
  return addr.trim().toLowerCase();
}

function isValidAddress(addr: string): boolean {
  return /^0x[a-f0-9]{40}$/.test(addr);
}

function envFallbackList(env: Env): string[] {
  return (env.ADMIN_ADDRESSES || '')
    .split(',')
    .map(normalize)
    .filter(isValidAddress);
}

async function readKv(env: Env): Promise<AdminRecord | null> {
  const raw = await env.SESSIONS.get(ADMIN_LIST_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminRecord;
  } catch {
    return null;
  }
}

async function writeKv(env: Env, record: AdminRecord): Promise<void> {
  await env.SESSIONS.put(ADMIN_LIST_KEY, JSON.stringify(record));
}

async function writeAudit(env: Env, action: string, target: string, by: string): Promise<void> {
  await env.SESSIONS.put(
    `audit:admin:${Date.now()}:${target}`,
    JSON.stringify({ action, target, by, at: new Date().toISOString() }),
    { expirationTtl: 86400 * 365 },
  );
}

export async function listAdmins(env: Env): Promise<string[]> {
  const record = await readKv(env);
  if (record) return record.addresses;
  return envFallbackList(env);
}

export async function isAdmin(env: Env, address: string): Promise<boolean> {
  const target = normalize(address);
  if (!isValidAddress(target)) return false;
  const list = await listAdmins(env);
  return list.includes(target);
}

// P001-PAI-0052: only super-admins can add/remove admins
export function isSuperAdmin(env: Env, address: string): boolean {
  const supers = (env.SUPER_ADMINS || '')
    .split(',')
    .map(normalize)
    .filter(isValidAddress);
  return supers.includes(normalize(address));
}

export async function addAdmin(env: Env, address: string, by: string): Promise<string[]> {
  const target = normalize(address);
  if (!isValidAddress(target)) throw new Error('invalid address');
  const current = await listAdmins(env);
  if (current.includes(target)) return current;
  const updated = [...current, target];
  await writeKv(env, { addresses: updated, updatedAt: Date.now(), updatedBy: by });
  await writeAudit(env, 'add', target, by);
  return updated;
}

export async function removeAdmin(env: Env, address: string, by: string): Promise<string[]> {
  const target = normalize(address);
  const current = await listAdmins(env);
  if (!current.includes(target)) return current;
  if (current.length === 1) throw new Error('cannot remove the last admin');
  const updated = current.filter((a) => a !== target);
  await writeKv(env, { addresses: updated, updatedAt: Date.now(), updatedBy: by });
  await writeAudit(env, 'remove', target, by);
  return updated;
}
