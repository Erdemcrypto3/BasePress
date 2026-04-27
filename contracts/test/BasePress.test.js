const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

// Comprehensive permit-flow tests live here. This is a placeholder — fill in
// during Phase 2 (V2 contract verification before mainnet deploy).
describe('BasePress V2', function () {
  it('initializes with correct params', async function () {
    const [owner, signer, treasury] = await ethers.getSigners();
    const BasePress = await ethers.getContractFactory('BasePress');
    const proxy = await upgrades.deployProxy(
      BasePress,
      [owner.address, signer.address, treasury.address, 500, 'BasePress', 'https://api/{id}'],
      { kind: 'uups', initializer: 'initialize' },
    );
    expect(await proxy.platformSigner()).to.equal(signer.address);
    expect(await proxy.platformTreasury()).to.equal(treasury.address);
    expect(await proxy.platformFeeBps()).to.equal(500n);
    expect(await proxy.blogName()).to.equal('BasePress');
  });

  it.skip('mintWithPermit happy path (TODO: Phase 2)', async function () {});
  it.skip('rejects expired permit (TODO: Phase 2)', async function () {});
  it.skip('rejects wrong signer (TODO: Phase 2)', async function () {});
  it.skip('rejects mismatched author on second mint (TODO: Phase 2)', async function () {});
  it.skip('respects maxSupply (TODO: Phase 2)', async function () {});
  it.skip('splits revenue 95/5 (TODO: Phase 2)', async function () {});
});
