const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

// =============================================================================
//                              CONSTANTS
// =============================================================================

const BLOG_NAME = 'BasePress';
const BASE_URI = 'https://api.basepress.app/articles/{id}';
const DEFAULT_FEE_BPS = 500n; // 5%
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const MINT_PRICE = ethers.parseEther('0.001');

// V4 EIP-712 typed-data — simplified permit (3 fields only).
const PERMIT_TYPES_V4 = {
  MintPermit: [
    { name: 'articleId', type: 'bytes32' },
    { name: 'author', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
};

// V3 EIP-712 typed-data — needed for the upgrade test fixture.
const PERMIT_TYPES_V3 = {
  MintPermit: [
    { name: 'articleId', type: 'bytes32' },
    { name: 'contentURI', type: 'string' },
    { name: 'author', type: 'address' },
    { name: 'price', type: 'uint256' },
    { name: 'maxSupply', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

// =============================================================================
//                              HELPERS
// =============================================================================

async function signPermitV4(signer, permit, verifyingContract, chainId) {
  const domain = {
    name: 'BasePress',
    version: '1',
    chainId,
    verifyingContract,
  };
  return signer.signTypedData(domain, PERMIT_TYPES_V4, permit);
}

async function signPermitV3(signer, permit, verifyingContract, chainId) {
  const domain = {
    name: 'BasePress',
    version: '1',
    chainId,
    verifyingContract,
  };
  return signer.signTypedData(domain, PERMIT_TYPES_V3, permit);
}

function articleIdFrom(slug) {
  return ethers.keccak256(ethers.toUtf8Bytes(slug));
}

function buildPermitV4(overrides = {}) {
  return {
    articleId: articleIdFrom('article-v4-default'),
    author: ZERO_ADDR,
    deadline: 0n,
    ...overrides,
  };
}

function buildPermitV3(overrides = {}) {
  return {
    articleId: articleIdFrom('article-v3-default'),
    contentURI: 'https://r2.basepress.app/articles/article-v3-default.html',
    author: ZERO_ADDR,
    price: MINT_PRICE,
    maxSupply: 0n,
    deadline: 0n,
    ...overrides,
  };
}

// =============================================================================
//                              FIXTURES
// =============================================================================

/**
 * Deploy V3 proxy, mint an article on V3, then upgrade to V4.
 * Validates the real upgrade path: V2 → V3 → V4.
 */
async function deployV4ViaUpgrade() {
  const [owner, platformSigner, treasury, alice, bob, carol, attacker] =
    await ethers.getSigners();

  // 1. Deploy V2 proxy
  const BasePress = await ethers.getContractFactory('BasePress');
  const proxy = await upgrades.deployProxy(
    BasePress,
    [
      owner.address,
      platformSigner.address,
      treasury.address,
      DEFAULT_FEE_BPS,
      BLOG_NAME,
      BASE_URI,
    ],
    { kind: 'uups', initializer: 'initialize' },
  );
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  const { chainId } = await ethers.provider.getNetwork();

  // 2. Mint an article on V2 (to test storage preservation across upgrades)
  const preUpgradeArticleId = articleIdFrom('pre-upgrade-v4');
  const v2Permit = buildPermitV3({
    articleId: preUpgradeArticleId,
    author: alice.address,
    maxSupply: 10n,
  });
  const v2Sig = await signPermitV3(platformSigner, v2Permit, proxyAddr, chainId);
  await proxy.connect(bob).mintWithPermit(v2Permit, v2Sig, { value: MINT_PRICE });

  // 3. Upgrade to V3
  const BasePressV3 = await ethers.getContractFactory('BasePressV3');
  const v3 = await upgrades.upgradeProxy(proxyAddr, BasePressV3);

  // 4. Upgrade to V4
  const BasePressV4 = await ethers.getContractFactory('BasePressV4');
  const v4 = await upgrades.upgradeProxy(proxyAddr, BasePressV4);

  return {
    proxy: v4,
    proxyAddr,
    chainId,
    owner,
    platformSigner,
    treasury,
    alice,
    bob,
    carol,
    attacker,
    preUpgradeArticleId,
  };
}

/**
 * Deploy V4 directly (fresh proxy).
 * Used for tests that don't need upgrade-specific assertions.
 */
async function deployV4Fresh() {
  const [owner, platformSigner, treasury, alice, bob, carol, attacker] =
    await ethers.getSigners();

  const BasePressV4 = await ethers.getContractFactory('BasePressV4');
  const proxy = await upgrades.deployProxy(
    BasePressV4,
    [
      owner.address,
      platformSigner.address,
      treasury.address,
      DEFAULT_FEE_BPS,
      BLOG_NAME,
      BASE_URI,
    ],
    { kind: 'uups', initializer: 'initialize' },
  );
  await proxy.waitForDeployment();

  const proxyAddr = await proxy.getAddress();
  const { chainId } = await ethers.provider.getNetwork();

  return {
    proxy,
    proxyAddr,
    chainId,
    owner,
    platformSigner,
    treasury,
    alice,
    bob,
    carol,
    attacker,
  };
}

// =============================================================================
//                              TEST SUITE
// =============================================================================

describe('BasePressV4', function () {
  // ---------------------------------------------------------------------------
  // Upgrade from V3 — storage preservation
  // ---------------------------------------------------------------------------
  describe('upgrade from V3', function () {
    it('preserves existing article author and totalMinted after V3→V4 upgrade', async function () {
      const { proxy, preUpgradeArticleId, alice } =
        await loadFixture(deployV4ViaUpgrade);

      const a = await proxy.articles(preUpgradeArticleId);
      expect(a.author).to.equal(alice.address);
      expect(a.totalMinted).to.equal(1n);
      expect(a.initialized).to.equal(true);
    });

    it('preserves balances after upgrade', async function () {
      const { proxy, alice } = await loadFixture(deployV4ViaUpgrade);

      const fee = (MINT_PRICE * DEFAULT_FEE_BPS) / 10000n;
      const authorShare = MINT_PRICE - fee;

      expect(await proxy.authorBalances(alice.address)).to.equal(authorShare);
      expect(await proxy.platformBalance()).to.equal(fee);
    });

    it('preserves platformSigner, treasury, feeBps, blogName', async function () {
      const { proxy, platformSigner, treasury } =
        await loadFixture(deployV4ViaUpgrade);

      expect(await proxy.platformSigner()).to.equal(platformSigner.address);
      expect(await proxy.platformTreasury()).to.equal(treasury.address);
      expect(await proxy.platformFeeBps()).to.equal(DEFAULT_FEE_BPS);
      expect(await proxy.blogName()).to.equal(BLOG_NAME);
    });

    it('ERC1155 balances preserved after upgrade', async function () {
      const { proxy, preUpgradeArticleId, bob } =
        await loadFixture(deployV4ViaUpgrade);

      const balance = await proxy.balanceOf(bob.address, BigInt(preUpgradeArticleId));
      expect(balance).to.equal(1n);
    });

    it('can mint on V4 after upgrade with new permit struct', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, carol } =
        await loadFixture(deployV4ViaUpgrade);

      const articleId = articleIdFrom('post-upgrade-v4-article');
      const permit = buildPermitV4({ articleId, author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(carol).mintWithPermit(permit, sig, { value: MINT_PRICE });

      const a = await proxy.articles(articleId);
      expect(a.author).to.equal(alice.address);
      expect(a.totalMinted).to.equal(1n);
    });
  });

  // ---------------------------------------------------------------------------
  // MINT_PRICE constant
  // ---------------------------------------------------------------------------
  describe('MINT_PRICE constant', function () {
    it('equals 0.001 ether', async function () {
      const { proxy } = await loadFixture(deployV4Fresh);
      expect(await proxy.MINT_PRICE()).to.equal(ethers.parseEther('0.001'));
    });
  });

  // ---------------------------------------------------------------------------
  // mintWithPermit — happy path
  // ---------------------------------------------------------------------------
  describe('mintWithPermit — happy path', function () {
    it('mints successfully with valid 3-field permit', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const articleId = articleIdFrom('happy-path');
      const permit = buildPermitV4({ articleId, author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE }),
      ).to.not.be.reverted;

      const a = await proxy.articles(articleId);
      expect(a.author).to.equal(alice.address);
      expect(a.totalMinted).to.equal(1n);
      expect(a.initialized).to.equal(true);
    });

    it('emits ArticleMinted with MINT_PRICE', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const articleId = articleIdFrom('emit-test');
      const permit = buildPermitV4({ articleId, author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE }))
        .to.emit(proxy, 'ArticleMinted')
        .withArgs(articleId, bob.address, alice.address, MINT_PRICE, 1n);
    });

    it('credits authorBalance and platformBalance correctly', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({ articleId: articleIdFrom('split-test'), author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE });

      const fee = (MINT_PRICE * DEFAULT_FEE_BPS) / 10000n;
      expect(await proxy.platformBalance()).to.equal(fee);
      expect(await proxy.authorBalances(alice.address)).to.equal(MINT_PRICE - fee);
    });
  });

  // ---------------------------------------------------------------------------
  // mintWithPermit — msg.value must equal MINT_PRICE
  // ---------------------------------------------------------------------------
  describe('mintWithPermit — payment validation', function () {
    it('reverts IncorrectPayment when msg.value < MINT_PRICE', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({ articleId: articleIdFrom('underpay'), author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE - 1n }),
      ).to.be.revertedWithCustomError(proxy, 'IncorrectPayment');
    });

    it('reverts IncorrectPayment when msg.value > MINT_PRICE', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({ articleId: articleIdFrom('overpay'), author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE + 1n }),
      ).to.be.revertedWithCustomError(proxy, 'IncorrectPayment');
    });

    it('reverts IncorrectPayment when msg.value is 0', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({ articleId: articleIdFrom('zero-pay'), author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: 0n }),
      ).to.be.revertedWithCustomError(proxy, 'IncorrectPayment');
    });
  });

  // ---------------------------------------------------------------------------
  // mintWithPermit — unlimited minting (no maxSupply cap)
  // ---------------------------------------------------------------------------
  describe('mintWithPermit — unlimited minting', function () {
    it('allows minting the same article many times without cap', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, bob, carol } =
        await loadFixture(deployV4Fresh);

      const articleId = articleIdFrom('unlimited-article');
      const permit = buildPermitV4({ articleId, author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      // Mint 5 times — no MaxSupplyReached
      for (let i = 0; i < 5; i++) {
        await proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE });
      }

      const a = await proxy.articles(articleId);
      expect(a.totalMinted).to.equal(5n);

      // Different minter also works
      await proxy.connect(carol).mintWithPermit(permit, sig, { value: MINT_PRICE });
      const a2 = await proxy.articles(articleId);
      expect(a2.totalMinted).to.equal(6n);
    });
  });

  // ---------------------------------------------------------------------------
  // mintWithPermit — deadline enforcement
  // ---------------------------------------------------------------------------
  describe('mintWithPermit — deadline', function () {
    it('reverts PermitExpired when deadline has passed', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      // deadline = 1 (unix timestamp in the past)
      const permit = buildPermitV4({
        articleId: articleIdFrom('expired'),
        author: alice.address,
        deadline: 1n,
      });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE }),
      ).to.be.revertedWithCustomError(proxy, 'PermitExpired');
    });

    it('succeeds when deadline is 0 (no expiry)', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({
        articleId: articleIdFrom('no-expiry'),
        author: alice.address,
        deadline: 0n,
      });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE }),
      ).to.not.be.reverted;
    });

    it('succeeds when deadline is in the future', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const futureDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const permit = buildPermitV4({
        articleId: articleIdFrom('future-deadline'),
        author: alice.address,
        deadline: futureDeadline,
      });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE }),
      ).to.not.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // mintWithPermit — revocation
  // ---------------------------------------------------------------------------
  describe('mintWithPermit — revocation', function () {
    it('reverts PermitRevoked for revoked article', async function () {
      const { proxy, owner, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const articleId = articleIdFrom('revoked-v4');
      const permit = buildPermitV4({ articleId, author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      // Mint once successfully
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE });

      // Revoke
      await proxy.connect(owner).revokeArticle(articleId);

      // Subsequent mint fails
      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE }),
      ).to.be.revertedWithCustomError(proxy, 'PermitRevoked');
    });

    it('revoking one article does not affect others', async function () {
      const { proxy, owner, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const revokedId = articleIdFrom('revoked-one-v4');
      const healthyId = articleIdFrom('healthy-one-v4');

      await proxy.connect(owner).revokeArticle(revokedId);

      const permit = buildPermitV4({ articleId: healthyId, author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE }),
      ).to.not.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // mintWithPermit — author validation
  // ---------------------------------------------------------------------------
  describe('mintWithPermit — author validation', function () {
    it('reverts with ZeroAddress for author == address(0)', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, bob } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({ articleId: articleIdFrom('zero-author'), author: ZERO_ADDR });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE }),
      ).to.be.revertedWithCustomError(proxy, 'ZeroAddress');
    });

    it('reverts with InvalidAuthor for author == address(this)', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, bob } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({ articleId: articleIdFrom('self-author'), author: proxyAddr });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE }),
      ).to.be.revertedWithCustomError(proxy, 'InvalidAuthor');
    });

    it('reverts InvalidSignature when author mismatches initialized article', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, bob, carol } =
        await loadFixture(deployV4Fresh);

      const articleId = articleIdFrom('author-mismatch');
      const permit1 = buildPermitV4({ articleId, author: alice.address });
      const sig1 = await signPermitV4(platformSigner, permit1, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit1, sig1, { value: MINT_PRICE });

      // Try to mint same article with different author
      const permit2 = buildPermitV4({ articleId, author: carol.address });
      const sig2 = await signPermitV4(platformSigner, permit2, proxyAddr, chainId);
      await expect(
        proxy.connect(bob).mintWithPermit(permit2, sig2, { value: MINT_PRICE }),
      ).to.be.revertedWithCustomError(proxy, 'InvalidSignature');
    });
  });

  // ---------------------------------------------------------------------------
  // mintWithPermit — signature validation
  // ---------------------------------------------------------------------------
  describe('mintWithPermit — signature validation', function () {
    it('reverts InvalidSignature when signed by wrong signer', async function () {
      const { proxy, proxyAddr, chainId, alice, bob, attacker } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({ articleId: articleIdFrom('bad-sig'), author: alice.address });
      const badSig = await signPermitV4(attacker, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, badSig, { value: MINT_PRICE }),
      ).to.be.revertedWithCustomError(proxy, 'InvalidSignature');
    });
  });

  // ---------------------------------------------------------------------------
  // Withdrawals
  // ---------------------------------------------------------------------------
  describe('withdrawals', function () {
    it('author can withdraw accumulated balance', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({ articleId: articleIdFrom('withdraw-author'), author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE });

      const fee = (MINT_PRICE * DEFAULT_FEE_BPS) / 10000n;
      const authorShare = MINT_PRICE - fee;

      await expect(proxy.connect(alice).withdrawAuthor()).to.changeEtherBalance(
        alice,
        authorShare,
      );
    });

    it('platform owner can withdraw platform balance', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, treasury, alice, bob } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({ articleId: articleIdFrom('withdraw-plat'), author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE });

      const fee = (MINT_PRICE * DEFAULT_FEE_BPS) / 10000n;
      await expect(proxy.withdrawPlatform()).to.changeEtherBalance(treasury, fee);
    });

    it('full lifecycle: mint, author withdraw, platform withdraw, zero balance', async function () {
      const { proxy, proxyAddr, chainId, platformSigner, treasury, alice, bob } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({ articleId: articleIdFrom('lifecycle'), author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE });

      await proxy.connect(alice).withdrawAuthor();
      await proxy.withdrawPlatform();
      expect(await ethers.provider.getBalance(proxyAddr)).to.equal(0n);
    });
  });

  // ---------------------------------------------------------------------------
  // Pause
  // ---------------------------------------------------------------------------
  describe('pause', function () {
    it('mintWithPermit reverts when paused', async function () {
      const { proxy, owner, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      await proxy.connect(owner).pause();

      const permit = buildPermitV4({ articleId: articleIdFrom('paused-mint'), author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE }),
      ).to.be.revertedWithCustomError(proxy, 'EnforcedPause');
    });

    it('withdrawAuthor reverts when paused', async function () {
      const { proxy, owner, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({ articleId: articleIdFrom('paused-withdraw'), author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE });

      await proxy.connect(owner).pause();

      await expect(
        proxy.connect(alice).withdrawAuthor(),
      ).to.be.revertedWithCustomError(proxy, 'EnforcedPause');
    });

    it('withdrawPlatform reverts when paused', async function () {
      const { proxy, owner, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      const permit = buildPermitV4({ articleId: articleIdFrom('paused-plat'), author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE });

      await proxy.connect(owner).pause();

      await expect(
        proxy.withdrawPlatform(),
      ).to.be.revertedWithCustomError(proxy, 'EnforcedPause');
    });

    it('operations resume after unpause', async function () {
      const { proxy, owner, proxyAddr, chainId, platformSigner, alice, bob } =
        await loadFixture(deployV4Fresh);

      await proxy.connect(owner).pause();
      await proxy.connect(owner).unpause();

      const permit = buildPermitV4({ articleId: articleIdFrom('unpaused'), author: alice.address });
      const sig = await signPermitV4(platformSigner, permit, proxyAddr, chainId);

      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: MINT_PRICE }),
      ).to.not.be.reverted;
    });
  });
});
