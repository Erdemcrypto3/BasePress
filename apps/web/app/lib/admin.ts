// Admin gate — UI-only check.
// Real authorization happens in:
//   1. basepress-api Worker (SIWE-verified address must match this list)
//   2. BasePress contract (mintWithPermit verifies platform signer at mint time)
//
// Putting wallet addresses in client config is fine — knowing a public address
// gives no power. The private key never leaves the admin's wallet.

const RAW = process.env.NEXT_PUBLIC_ADMIN_WALLETS || '';

export const ADMIN_WALLETS = RAW.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => /^0x[a-f0-9]{40}$/.test(s));

export function isAdminAddress(address: string | undefined): boolean {
  if (!address) return false;
  return ADMIN_WALLETS.includes(address.toLowerCase());
}
