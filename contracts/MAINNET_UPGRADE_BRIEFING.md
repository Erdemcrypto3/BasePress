# BasePressV3 Mainnet Upgrade Briefing

**Date:** 2026-05-02
**Prepared by:** Claude (Opus 4.6)
**Reviewed by:** Erdem (pending)

## What Changes

5 audit fixes bundled in a single UUPS upgrade (no data migration, append-only storage):

| PAI | Severity | Fix | Risk |
|-----|----------|-----|------|
| PAI-0001 | High | `revokeArticle()` — owner can revoke permits, minting reverts for revoked articles | New mapping added (slot 8), no existing slots touched |
| PAI-0005 | Medium | CEI ordering — `_mint` moved to end of `mintWithPermit`, balances credited first | Existing logic reordered, no new storage |
| PAI-0006 | Medium | Author validation — `address(0)` and `address(this)` rejected with `InvalidAuthor` | New require, no storage change |
| PAI-0007 | Medium | `whenNotPaused` added to `withdrawAuthor` + `withdrawPlatform` | Modifier added, no storage change |
| PAI-0008 | Medium | Pragma pinned to `0.8.24` (was `^0.8.24`) | Compile-time only |

## Validation Summary

| Check | Status |
|-------|--------|
| V3 test suite (32 tests) | PASSED |
| V2 regression (84 tests) | PASSED — no breakage |
| OZ storage layout validation | PASSED |
| Local dry-run (deploy V2 → upgrade V3) | PASSED |
| Base Sepolia testnet dry-run | PASSED |
| `isArticleRevoked()` on-chain verification | PASSED |
| `owner()` preserved after upgrade | PASSED |
| `paused()` preserved after upgrade | PASSED |

## Mainnet Targets

### Base
- Proxy: `0xAdf3d339B1030ac84fa56430C6a86455fBCEA5cd`
- Current impl: `0x6E0469B8B8f77A2cF941b296046b6CCb0547a2C8`
- Owner: `0x9E84D77264d94C646dF91A70dbae99C20330eAD0`

### Ink
- Proxy: `0xcaf3D13E55fc7c62c1fea07dcD3FbA0D682080Ab`
- Current impl: `0x0a6957070F332345BcFF0418FcDeF3b35c109f53`
- Owner: `0x9E84D77264d94C646dF91A70dbae99C20330eAD0`

## Upgrade Commands

### Base Mainnet
```bash
DEPLOY_PK=<from WCM Rabby-EVM-Deploy> \
  npx hardhat run scripts/upgrade-v3.js --network base
```

### Ink Mainnet
```bash
DEPLOY_PK=<from WCM Rabby-EVM-Deploy> \
  npx hardhat run scripts/upgrade-v3.js --network ink
```

## Post-Upgrade Verification

After each upgrade, verify:
```bash
# 1. Check implementation changed
npx hardhat console --network <network>
> const v3 = await ethers.getContractAt('BasePressV3', '<proxy>');
> await v3.isArticleRevoked('0x' + '00'.repeat(32))  // should return false
> await v3.owner()  // should return 0x9E84...eAD0
> await v3.paused()  // should return false

# 2. Verify on explorer
npx hardhat verify --network <network> <new_impl_address>
```

## Rollback Plan

UUPS upgrade is irreversible without deploying a V4 that reverts changes. However:
- No storage was deleted — only `revokedArticles` mapping added
- If issues found: call `pause()` immediately, then assess
- Owner can deploy V4 with fixes via same upgrade path

## Risk Assessment

**LOW RISK** — Rationale:
- Append-only storage (no slot reassignment)
- OZ storage layout validation passed
- Full test coverage on all new code paths
- Testnet dry-run successful
- No changes to minting economics or token metadata
- Worst case: pause contract, deploy V4

## Sign-Off

- [ ] Erdem reviewed this briefing
- [ ] Base mainnet upgrade executed
- [ ] Base mainnet verified on BaseScan
- [ ] Ink mainnet upgrade executed
- [ ] Ink mainnet verified on Blockscout
- [ ] PAI-0001, 0005, 0006, 0007, 0008 → status: deployed
- [ ] DevOps #445, #449, #450, #451, #452 → Closed
