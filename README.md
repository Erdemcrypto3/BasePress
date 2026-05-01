# BasePress

Multichain decentralized blog. Authors publish off-chain (Cloudflare R2), readers mint articles as ERC-1155 NFTs on any supported EVM chain via EIP-712 permits.

## Architecture

- **Frontend** (`apps/web`) — Next.js 15 + Tailwind, multichain wallet via wagmi/RainbowKit
- **API** (`workers/basepress-api`) — Cloudflare Worker: R2 storage, SIWE auth, permit registry
- **Contract** (`contracts/`) — `BasePress.sol` deployed once per chain (Base, Ink, +)
- **Packages** (`packages/{chain,wallet}`) — shared chain config + wallet provider

### Why off-chain publish?

Authors don't pay gas to publish. The same article is mintable on every supported chain without re-publishing — authors sign one EIP-712 permit **per chain** (the EIP-712 domain binds each signature to a specific `chainId` and `verifyingContract`, so signatures are not cross-chain replayable). The contract verifies the signature at mint time. See [docs/architecture.md](./docs/architecture.md).

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15, React 19, Tailwind, wagmi, RainbowKit, viem |
| API | Cloudflare Workers, Hono, R2, KV |
| Contract | Solidity 0.8.24, OpenZeppelin Upgradeable, EIP-712 |
| Tooling | Turborepo, pnpm workspaces, TypeScript, Hardhat |

## Quick start

```bash
pnpm install
pnpm dev          # all apps in parallel
pnpm --filter @basepress/web dev
pnpm --filter basepress-api dev
```

## Supported chains

Defined in `packages/chain/src/index.ts`. Add a new EVM chain by:
1. Adding the `defineChain` entry
2. Deploying `BasePress.sol` to the new chain via `pnpm --filter @basepress/contracts deploy:<network>`
3. Adding the contract address to `apps/web/app/lib/contract.ts`

No code changes elsewhere.

## License

MIT
