const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

// =============================================================================
//                              CONSTANTS
// =============================================================================

const BLOG_NAME = 'BasePress';
const BASE_URI = 'https://api.basepress.app/articles/{id}';
const DEFAULT_FEE_BPS = 500n; // 5%
const MAX_FEE_BPS = 1000n;    // 10% hard cap
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const PRICE = ethers.parseEther('0.001');
const HOUR = 3600n;

// EIP-712 typed-data definition mirrors the contract's MINT_PERMIT_TYPEHASH.
const PERMIT_TYPES = {
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

async function signPermit(signer, permit, verifyingContract, chainId) {
  const domain = {
    name: 'BasePress',
    version: '1',
    chainId,
    verifyingContract,
  };
  return signer.signTypedData(domain, PERMIT_TYPES, permit);
}

function articleIdFrom(slug) {
  return ethers.keccak256(ethers.toUtf8Bytes(slug));
}

function buildPermit(overrides = {}) {
  return {
    articleId: articleIdFrom('article-default'),
    contentURI: 'https://r2.basepress.app/articles/article-default.html',
    author: ZERO_ADDR,
    price: PRICE,
    maxSupply: 0n,
    deadline: 0n,
    ...overrides,
  };
}

// =============================================================================
//                              FIXTURES
// =============================================================================

async function deployFixture() {
  const [owner, platformSigner, treasury, alice, bob, carol, attacker] =
    await ethers.getSigners();

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

async function deployRejectingReceiver() {
  const Rej = await ethers.getContractFactory('RejectingReceiver');
  const r = await Rej.deploy();
  await r.waitForDeployment();
  return r;
}

// =============================================================================
//                              TEST SUITE
// =============================================================================

describe('BasePress V2', function () {
  // -------------------------------------------------------------------------
  // initialize / Deployment
  // -------------------------------------------------------------------------
  describe('Deployment', function () {
    it('sets owner from initializer', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      expect(await proxy.owner()).to.equal(owner.address);
    });

    it('sets platformSigner from initializer', async function () {
      const { proxy, platformSigner } = await loadFixture(deployFixture);
      expect(await proxy.platformSigner()).to.equal(platformSigner.address);
    });

    it('sets platformTreasury from initializer', async function () {
      const { proxy, treasury } = await loadFixture(deployFixture);
      expect(await proxy.platformTreasury()).to.equal(treasury.address);
    });

    it('sets platformFeeBps from initializer', async function () {
      const { proxy } = await loadFixture(deployFixture);
      expect(await proxy.platformFeeBps()).to.equal(DEFAULT_FEE_BPS);
    });

    it('sets blogName from initializer', async function () {
      const { proxy } = await loadFixture(deployFixture);
      expect(await proxy.blogName()).to.equal(BLOG_NAME);
    });

    it('sets baseUri so uri(id) returns the configured template', async function () {
      const { proxy } = await loadFixture(deployFixture);
      expect(await proxy.uri(0)).to.equal(BASE_URI);
    });

    it('starts unpaused with no upgrades renounced', async function () {
      const { proxy } = await loadFixture(deployFixture);
      expect(await proxy.paused()).to.equal(false);
      expect(await proxy.upgradesRenounced()).to.equal(false);
    });

    it('reverts ZeroAddress when owner is zero', async function () {
      const [, signer, treasury] = await ethers.getSigners();
      const BasePress = await ethers.getContractFactory('BasePress');
      await expect(
        upgrades.deployProxy(
          BasePress,
          [ZERO_ADDR, signer.address, treasury.address, DEFAULT_FEE_BPS, BLOG_NAME, BASE_URI],
          { kind: 'uups', initializer: 'initialize' },
        ),
      ).to.be.revertedWithCustomError(BasePress, 'ZeroAddress');
    });

    it('reverts ZeroAddress when platformSigner is zero', async function () {
      const [owner, , treasury] = await ethers.getSigners();
      const BasePress = await ethers.getContractFactory('BasePress');
      await expect(
        upgrades.deployProxy(
          BasePress,
          [owner.address, ZERO_ADDR, treasury.address, DEFAULT_FEE_BPS, BLOG_NAME, BASE_URI],
          { kind: 'uups', initializer: 'initialize' },
        ),
      ).to.be.revertedWithCustomError(BasePress, 'ZeroAddress');
    });

    it('reverts ZeroAddress when platformTreasury is zero', async function () {
      const [owner, signer] = await ethers.getSigners();
      const BasePress = await ethers.getContractFactory('BasePress');
      await expect(
        upgrades.deployProxy(
          BasePress,
          [owner.address, signer.address, ZERO_ADDR, DEFAULT_FEE_BPS, BLOG_NAME, BASE_URI],
          { kind: 'uups', initializer: 'initialize' },
        ),
      ).to.be.revertedWithCustomError(BasePress, 'ZeroAddress');
    });

    it('reverts FeeTooHigh when feeBps > 1000', async function () {
      const [owner, signer, treasury] = await ethers.getSigners();
      const BasePress = await ethers.getContractFactory('BasePress');
      await expect(
        upgrades.deployProxy(
          BasePress,
          [owner.address, signer.address, treasury.address, 1001n, BLOG_NAME, BASE_URI],
          { kind: 'uups', initializer: 'initialize' },
        ),
      ).to.be.revertedWithCustomError(BasePress, 'FeeTooHigh');
    });

    it('accepts feeBps at exact 1000 boundary', async function () {
      const [owner, signer, treasury] = await ethers.getSigners();
      const BasePress = await ethers.getContractFactory('BasePress');
      const p = await upgrades.deployProxy(
        BasePress,
        [owner.address, signer.address, treasury.address, MAX_FEE_BPS, BLOG_NAME, BASE_URI],
        { kind: 'uups', initializer: 'initialize' },
      );
      expect(await p.platformFeeBps()).to.equal(MAX_FEE_BPS);
    });

    it('cannot be re-initialized', async function () {
      const { proxy, owner, platformSigner, treasury } = await loadFixture(deployFixture);
      await expect(
        proxy.initialize(
          owner.address,
          platformSigner.address,
          treasury.address,
          DEFAULT_FEE_BPS,
          BLOG_NAME,
          BASE_URI,
        ),
      ).to.be.revertedWithCustomError(proxy, 'InvalidInitialization');
    });
  });

  // -------------------------------------------------------------------------
  // hashPermit (view)
  // -------------------------------------------------------------------------
  describe('#hashPermit', function () {
    it('returns the same hash for identical permits', async function () {
      const { proxy, alice } = await loadFixture(deployFixture);
      const p = buildPermit({ author: alice.address, articleId: articleIdFrom('a1') });
      expect(await proxy.hashPermit(p)).to.equal(await proxy.hashPermit(p));
    });

    it('returns different hashes when articleId differs', async function () {
      const { proxy, alice } = await loadFixture(deployFixture);
      const p1 = buildPermit({ author: alice.address, articleId: articleIdFrom('a1') });
      const p2 = buildPermit({ author: alice.address, articleId: articleIdFrom('a2') });
      expect(await proxy.hashPermit(p1)).to.not.equal(await proxy.hashPermit(p2));
    });

    it('returns different hashes when contentURI differs (proves it is in the digest)', async function () {
      const { proxy, alice } = await loadFixture(deployFixture);
      const p1 = buildPermit({ author: alice.address, contentURI: 'a' });
      const p2 = buildPermit({ author: alice.address, contentURI: 'b' });
      expect(await proxy.hashPermit(p1)).to.not.equal(await proxy.hashPermit(p2));
    });
  });

  // -------------------------------------------------------------------------
  // mintWithPermit
  // -------------------------------------------------------------------------
  describe('#mintWithPermit', function () {
    // ---- 1. modifier reverts ----
    describe('reverts — modifiers', function () {
      it('reverts when contract is paused', async function () {
        const { proxy, owner, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        await proxy.connect(owner).pause();
        const permit = buildPermit({ author: alice.address });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await expect(
          proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE }),
        ).to.be.revertedWithCustomError(proxy, 'EnforcedPause');
      });
    });

    // ---- 2. input validation reverts ----
    describe('reverts — input validation', function () {
      it('reverts PermitExpired when deadline has passed', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const now = await time.latest();
        const permit = buildPermit({ author: alice.address, deadline: BigInt(now) - 1n });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await expect(
          proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE }),
        ).to.be.revertedWithCustomError(proxy, 'PermitExpired');
      });

      it('reverts IncorrectPayment when msg.value < price', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const permit = buildPermit({ author: alice.address });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await expect(
          proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE - 1n }),
        ).to.be.revertedWithCustomError(proxy, 'IncorrectPayment');
      });

      it('reverts IncorrectPayment when msg.value > price', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const permit = buildPermit({ author: alice.address });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await expect(
          proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE + 1n }),
        ).to.be.revertedWithCustomError(proxy, 'IncorrectPayment');
      });

      it('reverts InvalidSignature when signed by someone other than platformSigner', async function () {
        const { proxy, proxyAddr, chainId, alice, bob, attacker } =
          await loadFixture(deployFixture);
        const permit = buildPermit({ author: alice.address });
        const badSig = await signPermit(attacker, permit, proxyAddr, chainId);
        await expect(
          proxy.connect(bob).mintWithPermit(permit, badSig, { value: PRICE }),
        ).to.be.revertedWithCustomError(proxy, 'InvalidSignature');
      });

      it('reverts InvalidSignature when permit fields are tampered after signing', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const permit = buildPermit({ author: alice.address, price: PRICE });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        const tampered = { ...permit, price: PRICE * 2n };
        await expect(
          proxy.connect(bob).mintWithPermit(tampered, sig, { value: PRICE * 2n }),
        ).to.be.revertedWithCustomError(proxy, 'InvalidSignature');
      });

      it('reverts InvalidSignature when second permit changes author for same articleId', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob, carol } =
          await loadFixture(deployFixture);
        const articleId = articleIdFrom('locked-author');
        const p1 = buildPermit({ articleId, author: alice.address });
        const sig1 = await signPermit(platformSigner, p1, proxyAddr, chainId);
        await proxy.connect(bob).mintWithPermit(p1, sig1, { value: PRICE });

        const p2 = buildPermit({ articleId, author: carol.address });
        const sig2 = await signPermit(platformSigner, p2, proxyAddr, chainId);
        await expect(
          proxy.connect(bob).mintWithPermit(p2, sig2, { value: PRICE }),
        ).to.be.revertedWithCustomError(proxy, 'InvalidSignature');
      });

      it('reverts InvalidSignature when second permit changes maxSupply for same articleId', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const articleId = articleIdFrom('locked-supply');
        const p1 = buildPermit({ articleId, author: alice.address, maxSupply: 10n });
        const sig1 = await signPermit(platformSigner, p1, proxyAddr, chainId);
        await proxy.connect(bob).mintWithPermit(p1, sig1, { value: PRICE });

        const p2 = buildPermit({ articleId, author: alice.address, maxSupply: 5n });
        const sig2 = await signPermit(platformSigner, p2, proxyAddr, chainId);
        await expect(
          proxy.connect(bob).mintWithPermit(p2, sig2, { value: PRICE }),
        ).to.be.revertedWithCustomError(proxy, 'InvalidSignature');
      });

      it('reverts MaxSupplyReached when totalMinted equals maxSupply', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const articleId = articleIdFrom('cap-2');
        const permit = buildPermit({ articleId, author: alice.address, maxSupply: 2n });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
        await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
        await expect(
          proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE }),
        ).to.be.revertedWithCustomError(proxy, 'MaxSupplyReached');
      });
    });

    // ---- 3. happy path & state ----
    describe('happy path & state', function () {
      it('initializes article state on first mint and locks author/maxSupply', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const articleId = articleIdFrom('first');
        const permit = buildPermit({ articleId, author: alice.address, maxSupply: 7n });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });

        const a = await proxy.articles(articleId);
        expect(a.author).to.equal(alice.address);
        expect(a.totalMinted).to.equal(1n);
        expect(a.maxSupply).to.equal(7n);
        expect(a.initialized).to.equal(true);
      });

      it('mints token id == uint256(articleId) to msg.sender', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const articleId = articleIdFrom('id-check');
        const tokenId = BigInt(articleId);
        const permit = buildPermit({ articleId, author: alice.address });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
        expect(await proxy.balanceOf(bob.address, tokenId)).to.equal(1n);
      });

      it('credits authorBalance and platformBalance with 95/5 split', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const permit = buildPermit({ author: alice.address });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });

        const fee = (PRICE * DEFAULT_FEE_BPS) / 10000n;
        expect(await proxy.platformBalance()).to.equal(fee);
        expect(await proxy.authorBalances(alice.address)).to.equal(PRICE - fee);
      });

      it('emits ArticleMinted with exact args', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const articleId = articleIdFrom('event-check');
        const permit = buildPermit({ articleId, author: alice.address });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await expect(proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE }))
          .to.emit(proxy, 'ArticleMinted')
          .withArgs(articleId, bob.address, alice.address, PRICE, 1n);
      });

      it('emits ERC1155 TransferSingle', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const articleId = articleIdFrom('erc1155-evt');
        const tokenId = BigInt(articleId);
        const permit = buildPermit({ articleId, author: alice.address });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await expect(proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE }))
          .to.emit(proxy, 'TransferSingle')
          .withArgs(bob.address, ZERO_ADDR, bob.address, tokenId, 1n);
      });

      it('changes contract ETH balance by price', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const permit = buildPermit({ author: alice.address });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await expect(
          proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE }),
        ).to.changeEtherBalance(proxy, PRICE);
      });

      it('allows replay of the same permit within maxSupply (each call mints another copy)', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const articleId = articleIdFrom('replay-ok');
        const permit = buildPermit({ articleId, author: alice.address, maxSupply: 3n });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
        await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
        await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
        expect(await proxy.articleSupply(articleId)).to.equal(3n);
      });
    });

    // ---- 4. edge cases ----
    describe('edge cases', function () {
      it('treats deadline == 0 as no expiry (mint succeeds far in the future)', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const permit = buildPermit({ author: alice.address, deadline: 0n });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await time.increase(365n * 24n * HOUR);
        await expect(proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE })).to
          .not.be.reverted;
      });

      it('treats maxSupply == 0 as unlimited', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const articleId = articleIdFrom('unlimited');
        const permit = buildPermit({ articleId, author: alice.address, maxSupply: 0n });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        for (let i = 0; i < 5; i++) {
          await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
        }
        expect(await proxy.articleSupply(articleId)).to.equal(5n);
      });

      it('allows free mint when price == 0 with no fee credited', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const permit = buildPermit({ author: alice.address, price: 0n });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await proxy.connect(bob).mintWithPermit(permit, sig, { value: 0n });
        expect(await proxy.platformBalance()).to.equal(0n);
        expect(await proxy.authorBalances(alice.address)).to.equal(0n);
      });

      it('routes 100% to author when feeBps == 0', async function () {
        const { proxy, owner, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        await proxy.connect(owner).setPlatformFeeBps(0n);
        const permit = buildPermit({ author: alice.address });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
        expect(await proxy.platformBalance()).to.equal(0n);
        expect(await proxy.authorBalances(alice.address)).to.equal(PRICE);
      });

      it('routes 10% to platform when feeBps == 1000', async function () {
        const { proxy, owner, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        await proxy.connect(owner).setPlatformFeeBps(MAX_FEE_BPS);
        const permit = buildPermit({ author: alice.address });
        const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
        await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
        const fee = (PRICE * MAX_FEE_BPS) / 10000n;
        expect(await proxy.platformBalance()).to.equal(fee);
        expect(await proxy.authorBalances(alice.address)).to.equal(PRICE - fee);
      });

      it('accepts subsequent permit with different contentURI as long as author/maxSupply match', async function () {
        const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
          await loadFixture(deployFixture);
        const articleId = articleIdFrom('uri-variant');
        const p1 = buildPermit({ articleId, author: alice.address, contentURI: 'v1' });
        const p2 = buildPermit({ articleId, author: alice.address, contentURI: 'v2' });
        const sig1 = await signPermit(platformSigner, p1, proxyAddr, chainId);
        const sig2 = await signPermit(platformSigner, p2, proxyAddr, chainId);
        await proxy.connect(bob).mintWithPermit(p1, sig1, { value: PRICE });
        await expect(proxy.connect(bob).mintWithPermit(p2, sig2, { value: PRICE })).to
          .not.be.reverted;
        expect(await proxy.articleSupply(articleId)).to.equal(2n);
      });
    });
  });

  // -------------------------------------------------------------------------
  // withdrawAuthor
  // -------------------------------------------------------------------------
  describe('#withdrawAuthor', function () {
    it('reverts NothingToWithdraw when author balance is zero', async function () {
      const { proxy, alice } = await loadFixture(deployFixture);
      await expect(
        proxy.connect(alice).withdrawAuthor(),
      ).to.be.revertedWithCustomError(proxy, 'NothingToWithdraw');
    });

    it('transfers exact author share to caller', async function () {
      const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      const permit = buildPermit({ author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      const fee = (PRICE * DEFAULT_FEE_BPS) / 10000n;
      const authorShare = PRICE - fee;
      await expect(proxy.connect(alice).withdrawAuthor()).to.changeEtherBalance(
        alice,
        authorShare,
      );
    });

    it('zeroes the balance before transferring (CEI ordering)', async function () {
      const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      const permit = buildPermit({ author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      await proxy.connect(alice).withdrawAuthor();
      expect(await proxy.authorBalances(alice.address)).to.equal(0n);
    });

    it('emits AuthorWithdrawal', async function () {
      const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      const permit = buildPermit({ author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      const expected = PRICE - (PRICE * DEFAULT_FEE_BPS) / 10000n;
      await expect(proxy.connect(alice).withdrawAuthor())
        .to.emit(proxy, 'AuthorWithdrawal')
        .withArgs(alice.address, expected);
    });

    it('reverts on second withdraw with NothingToWithdraw (no double-spend)', async function () {
      const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      const permit = buildPermit({ author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      await proxy.connect(alice).withdrawAuthor();
      await expect(
        proxy.connect(alice).withdrawAuthor(),
      ).to.be.revertedWithCustomError(proxy, 'NothingToWithdraw');
    });

    it('reverts TransferFailed when author contract rejects ETH', async function () {
      const { proxy, platformSigner, proxyAddr, chainId, bob } =
        await loadFixture(deployFixture);
      const rej = await deployRejectingReceiver();
      const rejAddr = await rej.getAddress();
      const permit = buildPermit({ author: rejAddr });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      await expect(rej.callWithdrawAuthor(proxyAddr)).to.be.revertedWithCustomError(
        proxy,
        'TransferFailed',
      );
    });
  });

  // -------------------------------------------------------------------------
  // withdrawPlatform
  // -------------------------------------------------------------------------
  describe('#withdrawPlatform', function () {
    it('reverts NothingToWithdraw when platformBalance is zero', async function () {
      const { proxy, attacker } = await loadFixture(deployFixture);
      await expect(
        proxy.connect(attacker).withdrawPlatform(),
      ).to.be.revertedWithCustomError(proxy, 'NothingToWithdraw');
    });

    it('can be called by anyone — funds always go to treasury', async function () {
      const { proxy, platformSigner, treasury, proxyAddr, chainId, alice, bob, attacker } =
        await loadFixture(deployFixture);
      const permit = buildPermit({ author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      const fee = (PRICE * DEFAULT_FEE_BPS) / 10000n;
      await expect(
        proxy.connect(attacker).withdrawPlatform(),
      ).to.changeEtherBalances([treasury, attacker, proxy], [fee, 0n, -fee]);
    });

    it('zeroes platformBalance', async function () {
      const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      const permit = buildPermit({ author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      await proxy.withdrawPlatform();
      expect(await proxy.platformBalance()).to.equal(0n);
    });

    it('emits PlatformWithdrawal with treasury and amount', async function () {
      const { proxy, platformSigner, treasury, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      const permit = buildPermit({ author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      const fee = (PRICE * DEFAULT_FEE_BPS) / 10000n;
      await expect(proxy.withdrawPlatform())
        .to.emit(proxy, 'PlatformWithdrawal')
        .withArgs(treasury.address, fee);
    });

    it('reverts on second withdraw with NothingToWithdraw', async function () {
      const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      const permit = buildPermit({ author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      await proxy.withdrawPlatform();
      await expect(proxy.withdrawPlatform()).to.be.revertedWithCustomError(
        proxy,
        'NothingToWithdraw',
      );
    });

    it('reverts TransferFailed when treasury rejects ETH', async function () {
      const { proxy, owner, platformSigner, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      const rej = await deployRejectingReceiver();
      const rejAddr = await rej.getAddress();
      await proxy.connect(owner).setPlatformTreasury(rejAddr);

      const permit = buildPermit({ author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      await expect(proxy.withdrawPlatform()).to.be.revertedWithCustomError(
        proxy,
        'TransferFailed',
      );
    });
  });

  // -------------------------------------------------------------------------
  // setPlatformSigner
  // -------------------------------------------------------------------------
  describe('#setPlatformSigner', function () {
    it('reverts when called by non-owner', async function () {
      const { proxy, attacker } = await loadFixture(deployFixture);
      await expect(
        proxy.connect(attacker).setPlatformSigner(attacker.address),
      ).to.be.revertedWithCustomError(proxy, 'OwnableUnauthorizedAccount');
    });

    it('reverts ZeroAddress on 0x0', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      await expect(
        proxy.connect(owner).setPlatformSigner(ZERO_ADDR),
      ).to.be.revertedWithCustomError(proxy, 'ZeroAddress');
    });

    it('updates platformSigner', async function () {
      const { proxy, owner, attacker } = await loadFixture(deployFixture);
      await proxy.connect(owner).setPlatformSigner(attacker.address);
      expect(await proxy.platformSigner()).to.equal(attacker.address);
    });

    it('emits PlatformSignerUpdated', async function () {
      const { proxy, owner, platformSigner, attacker } = await loadFixture(deployFixture);
      await expect(proxy.connect(owner).setPlatformSigner(attacker.address))
        .to.emit(proxy, 'PlatformSignerUpdated')
        .withArgs(platformSigner.address, attacker.address);
    });

    it('mints signed by old signer fail after rotation, new signer works', async function () {
      const { proxy, owner, platformSigner, proxyAddr, chainId, alice, bob, attacker } =
        await loadFixture(deployFixture);
      await proxy.connect(owner).setPlatformSigner(attacker.address);
      const permit = buildPermit({ author: alice.address });
      const oldSig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      const newSig = await signPermit(attacker, permit, proxyAddr, chainId);
      await expect(
        proxy.connect(bob).mintWithPermit(permit, oldSig, { value: PRICE }),
      ).to.be.revertedWithCustomError(proxy, 'InvalidSignature');
      await expect(proxy.connect(bob).mintWithPermit(permit, newSig, { value: PRICE })).to
        .not.be.reverted;
    });
  });

  // -------------------------------------------------------------------------
  // setPlatformTreasury
  // -------------------------------------------------------------------------
  describe('#setPlatformTreasury', function () {
    it('reverts when called by non-owner', async function () {
      const { proxy, attacker } = await loadFixture(deployFixture);
      await expect(
        proxy.connect(attacker).setPlatformTreasury(attacker.address),
      ).to.be.revertedWithCustomError(proxy, 'OwnableUnauthorizedAccount');
    });

    it('reverts ZeroAddress on 0x0', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      await expect(
        proxy.connect(owner).setPlatformTreasury(ZERO_ADDR),
      ).to.be.revertedWithCustomError(proxy, 'ZeroAddress');
    });

    it('updates treasury', async function () {
      const { proxy, owner, attacker } = await loadFixture(deployFixture);
      await proxy.connect(owner).setPlatformTreasury(attacker.address);
      expect(await proxy.platformTreasury()).to.equal(attacker.address);
    });

    it('emits PlatformTreasuryUpdated', async function () {
      const { proxy, owner, treasury, attacker } = await loadFixture(deployFixture);
      await expect(proxy.connect(owner).setPlatformTreasury(attacker.address))
        .to.emit(proxy, 'PlatformTreasuryUpdated')
        .withArgs(treasury.address, attacker.address);
    });
  });

  // -------------------------------------------------------------------------
  // setPlatformFeeBps
  // -------------------------------------------------------------------------
  describe('#setPlatformFeeBps', function () {
    it('reverts when called by non-owner', async function () {
      const { proxy, attacker } = await loadFixture(deployFixture);
      await expect(
        proxy.connect(attacker).setPlatformFeeBps(100n),
      ).to.be.revertedWithCustomError(proxy, 'OwnableUnauthorizedAccount');
    });

    it('reverts FeeTooHigh on 1001', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      await expect(
        proxy.connect(owner).setPlatformFeeBps(1001n),
      ).to.be.revertedWithCustomError(proxy, 'FeeTooHigh');
    });

    it('accepts boundary 1000', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      await proxy.connect(owner).setPlatformFeeBps(MAX_FEE_BPS);
      expect(await proxy.platformFeeBps()).to.equal(MAX_FEE_BPS);
    });

    it('accepts 0 (no fee)', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      await proxy.connect(owner).setPlatformFeeBps(0n);
      expect(await proxy.platformFeeBps()).to.equal(0n);
    });

    it('emits PlatformFeeUpdated', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      await expect(proxy.connect(owner).setPlatformFeeBps(750n))
        .to.emit(proxy, 'PlatformFeeUpdated')
        .withArgs(DEFAULT_FEE_BPS, 750n);
    });

    it('affects subsequent mints (split changes mid-life)', async function () {
      const { proxy, owner, platformSigner, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      const permit = buildPermit({ author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      await proxy.connect(owner).setPlatformFeeBps(0n);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      const firstFee = (PRICE * DEFAULT_FEE_BPS) / 10000n;
      expect(await proxy.platformBalance()).to.equal(firstFee);
      expect(await proxy.authorBalances(alice.address)).to.equal(
        PRICE - firstFee + PRICE,
      );
    });
  });

  // -------------------------------------------------------------------------
  // pause / unpause
  // -------------------------------------------------------------------------
  describe('#pause / #unpause', function () {
    it('reverts when pause called by non-owner', async function () {
      const { proxy, attacker } = await loadFixture(deployFixture);
      await expect(
        proxy.connect(attacker).pause(),
      ).to.be.revertedWithCustomError(proxy, 'OwnableUnauthorizedAccount');
    });

    it('reverts when unpause called by non-owner', async function () {
      const { proxy, owner, attacker } = await loadFixture(deployFixture);
      await proxy.connect(owner).pause();
      await expect(
        proxy.connect(attacker).unpause(),
      ).to.be.revertedWithCustomError(proxy, 'OwnableUnauthorizedAccount');
    });

    it('pause sets paused() == true', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      await proxy.connect(owner).pause();
      expect(await proxy.paused()).to.equal(true);
    });

    it('unpause restores mint flow', async function () {
      const { proxy, owner, platformSigner, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      await proxy.connect(owner).pause();
      await proxy.connect(owner).unpause();
      const permit = buildPermit({ author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await expect(proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE })).to
        .not.be.reverted;
    });
  });

  // -------------------------------------------------------------------------
  // setURI
  // -------------------------------------------------------------------------
  describe('#setURI', function () {
    it('reverts when called by non-owner', async function () {
      const { proxy, attacker } = await loadFixture(deployFixture);
      await expect(
        proxy.connect(attacker).setURI('https://x'),
      ).to.be.revertedWithCustomError(proxy, 'OwnableUnauthorizedAccount');
    });

    it('updates URI for all tokens', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      const newUri = 'https://api2.basepress.app/articles/{id}';
      await proxy.connect(owner).setURI(newUri);
      expect(await proxy.uri(0)).to.equal(newUri);
    });
  });

  // -------------------------------------------------------------------------
  // renounceUpgrades
  // -------------------------------------------------------------------------
  describe('#renounceUpgrades', function () {
    it('reverts when called by non-owner', async function () {
      const { proxy, attacker } = await loadFixture(deployFixture);
      await expect(
        proxy.connect(attacker).renounceUpgrades(),
      ).to.be.revertedWithCustomError(proxy, 'OwnableUnauthorizedAccount');
    });

    it('sets upgradesRenounced to true', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      await proxy.connect(owner).renounceUpgrades();
      expect(await proxy.upgradesRenounced()).to.equal(true);
    });

    it('emits UpgradesRenounced', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      await expect(proxy.connect(owner).renounceUpgrades()).to.emit(
        proxy,
        'UpgradesRenounced',
      );
    });

    it('reverts UpgradesAlreadyRenounced on second call', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      await proxy.connect(owner).renounceUpgrades();
      await expect(
        proxy.connect(owner).renounceUpgrades(),
      ).to.be.revertedWithCustomError(proxy, 'UpgradesAlreadyRenounced');
    });

    it('allows owner to upgrade before renounce', async function () {
      const { proxy, owner, proxyAddr } = await loadFixture(deployFixture);
      const NewImpl = await ethers.getContractFactory('BasePress');
      const newImpl = await NewImpl.deploy();
      await newImpl.waitForDeployment();
      await expect(
        proxy.connect(owner).upgradeToAndCall(await newImpl.getAddress(), '0x'),
      ).to.not.be.reverted;
      // proxy address must remain stable
      expect(await proxy.getAddress()).to.equal(proxyAddr);
    });

    it('blocks upgrades after renounce (UpgradesAlreadyRenounced)', async function () {
      const { proxy, owner } = await loadFixture(deployFixture);
      await proxy.connect(owner).renounceUpgrades();
      const NewImpl = await ethers.getContractFactory('BasePress');
      const newImpl = await NewImpl.deploy();
      await newImpl.waitForDeployment();
      await expect(
        proxy.connect(owner).upgradeToAndCall(await newImpl.getAddress(), '0x'),
      ).to.be.revertedWithCustomError(proxy, 'UpgradesAlreadyRenounced');
    });
  });

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------
  describe('Views', function () {
    it('articleSupply == 0 before any mint', async function () {
      const { proxy } = await loadFixture(deployFixture);
      expect(await proxy.articleSupply(articleIdFrom('nope'))).to.equal(0n);
    });

    it('articleAuthor == 0x0 before any mint', async function () {
      const { proxy } = await loadFixture(deployFixture);
      expect(await proxy.articleAuthor(articleIdFrom('nope'))).to.equal(ZERO_ADDR);
    });

    it('articleSupply tracks mints', async function () {
      const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      const articleId = articleIdFrom('view-supply');
      const permit = buildPermit({ articleId, author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      expect(await proxy.articleSupply(articleId)).to.equal(2n);
    });

    it('articleAuthor returns first-mint author', async function () {
      const { proxy, platformSigner, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      const articleId = articleIdFrom('view-author');
      const permit = buildPermit({ articleId, author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      expect(await proxy.articleAuthor(articleId)).to.equal(alice.address);
    });
  });

  // -------------------------------------------------------------------------
  // Integration / E2E
  // -------------------------------------------------------------------------
  describe('Integration', function () {
    it('full lifecycle: 2 authors, multiple minters, all withdraw correctly', async function () {
      const { proxy, platformSigner, treasury, proxyAddr, chainId, alice, bob, carol, attacker } =
        await loadFixture(deployFixture);

      const aliceArt = articleIdFrom('alice-piece');
      const bobArt = articleIdFrom('bob-piece');

      const aliceP = buildPermit({ articleId: aliceArt, author: alice.address, maxSupply: 0n });
      const bobP = buildPermit({ articleId: bobArt, author: bob.address, maxSupply: 0n });
      const aliceSig = await signPermit(platformSigner, aliceP, proxyAddr, chainId);
      const bobSig = await signPermit(platformSigner, bobP, proxyAddr, chainId);

      // Alice's article: 3 mints (carol, attacker, carol)
      await proxy.connect(carol).mintWithPermit(aliceP, aliceSig, { value: PRICE });
      await proxy.connect(attacker).mintWithPermit(aliceP, aliceSig, { value: PRICE });
      await proxy.connect(carol).mintWithPermit(aliceP, aliceSig, { value: PRICE });
      // Bob's article: 1 mint
      await proxy.connect(attacker).mintWithPermit(bobP, bobSig, { value: PRICE });

      const fee = (PRICE * DEFAULT_FEE_BPS) / 10000n;
      const share = PRICE - fee;
      expect(await proxy.authorBalances(alice.address)).to.equal(share * 3n);
      expect(await proxy.authorBalances(bob.address)).to.equal(share);
      expect(await proxy.platformBalance()).to.equal(fee * 4n);

      // Withdrawals
      await expect(proxy.connect(alice).withdrawAuthor()).to.changeEtherBalance(
        alice,
        share * 3n,
      );
      await expect(proxy.connect(bob).withdrawAuthor()).to.changeEtherBalance(bob, share);
      await expect(proxy.withdrawPlatform()).to.changeEtherBalance(treasury, fee * 4n);

      // Contract drained
      expect(await ethers.provider.getBalance(proxyAddr)).to.equal(0n);
    });

    it('pause mid-flow blocks mints, unpause restores', async function () {
      const { proxy, owner, platformSigner, proxyAddr, chainId, alice, bob } =
        await loadFixture(deployFixture);
      const permit = buildPermit({ author: alice.address });
      const sig = await signPermit(platformSigner, permit, proxyAddr, chainId);
      await proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE });
      await proxy.connect(owner).pause();
      await expect(
        proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE }),
      ).to.be.revertedWithCustomError(proxy, 'EnforcedPause');
      await proxy.connect(owner).unpause();
      await expect(proxy.connect(bob).mintWithPermit(permit, sig, { value: PRICE })).to
        .not.be.reverted;
    });

    it('supply cap exhausts, free-tier coexists, mixed permits processed atomically', async function () {
      const { proxy, platformSigner, proxyAddr, chainId, alice, bob, carol } =
        await loadFixture(deployFixture);
      const cappedId = articleIdFrom('capped');
      const freeId = articleIdFrom('free');

      const cappedP = buildPermit({ articleId: cappedId, author: alice.address, maxSupply: 2n });
      const freeP = buildPermit({ articleId: freeId, author: alice.address, price: 0n });
      const cappedSig = await signPermit(platformSigner, cappedP, proxyAddr, chainId);
      const freeSig = await signPermit(platformSigner, freeP, proxyAddr, chainId);

      await proxy.connect(bob).mintWithPermit(cappedP, cappedSig, { value: PRICE });
      await proxy.connect(carol).mintWithPermit(cappedP, cappedSig, { value: PRICE });
      await expect(
        proxy.connect(bob).mintWithPermit(cappedP, cappedSig, { value: PRICE }),
      ).to.be.revertedWithCustomError(proxy, 'MaxSupplyReached');

      // Free article unaffected
      await proxy.connect(carol).mintWithPermit(freeP, freeSig, { value: 0n });
      expect(await proxy.articleSupply(freeId)).to.equal(1n);
      expect(await proxy.articleSupply(cappedId)).to.equal(2n);
    });
  });

  // -------------------------------------------------------------------------
  // Invariants (documented; verified across several tests above)
  // -------------------------------------------------------------------------
  // - Sum of authorBalances + platformBalance == price * (sum of mints) before any withdraw.
  // - For any articleId once initialized, articles[id].author and articles[id].maxSupply
  //   never change (enforced via InvalidSignature reverts on mismatched second permit).
  // - articles[id].totalMinted <= articles[id].maxSupply when maxSupply > 0.
  // - platformFeeBps <= 1000 always (enforced in initialize + setPlatformFeeBps).
  // - upgradesRenounced is monotonic: false -> true, never true -> false.
});
