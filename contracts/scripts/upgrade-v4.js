const { ethers, upgrades, network } = require('hardhat');

const PROXY_ADDRESSES = {
  base: '0xAdf3d339B1030ac84fa56430C6a86455fBCEA5cd',
  ink: '0xcaf3D13E55fc7c62c1fea07dcD3FbA0D682080Ab',
  baseSepolia: '0x0AeD78c4Dc1b9ee1AcD1282064F094ecB4764529',
  inkSepolia: process.env.TESTNET_PROXY_INK,
};

async function main() {
  const proxyAddress = PROXY_ADDRESSES[network.name];
  if (!proxyAddress) {
    throw new Error(`No proxy address configured for network: ${network.name}`);
  }

  const [deployer] = await ethers.getSigners();
  console.log(`\nUpgrading BasePress V3 → V4 on ${network.name}`);
  console.log(`  Proxy:    ${proxyAddress}`);
  console.log(`  Deployer: ${deployer.address}`);

  const implBefore = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`  Impl (before): ${implBefore}`);

  const BasePressV4 = await ethers.getContractFactory('BasePressV4');

  await upgrades.validateUpgrade(proxyAddress, BasePressV4, { kind: 'uups' });
  console.log('  Storage layout validation PASSED');

  const v4 = await upgrades.upgradeProxy(proxyAddress, BasePressV4, {
    redeployImplementation: 'always',
  });
  await v4.waitForDeployment();

  const implAfter = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`  Impl (after):  ${implAfter}`);

  if (implBefore === implAfter) {
    console.log('  WARNING: implementation address unchanged — upgrade may not have taken effect');
  }

  const owner = await v4.owner();
  const price = await v4.MINT_PRICE();
  const paused = await v4.paused();
  console.log(`  owner():      ${owner}`);
  console.log(`  MINT_PRICE(): ${ethers.formatEther(price)} ETH`);
  console.log(`  paused():     ${paused}`);

  console.log('\nUpgrade complete. Verify the new implementation:');
  console.log(`  npx hardhat verify --network ${network.name} ${implAfter}`);
}

main().catch((err) => {
  console.error('UPGRADE FAILED:', err.message);
  process.exit(1);
});
