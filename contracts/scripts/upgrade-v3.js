const { ethers, upgrades, network } = require('hardhat');

const PROXY_ADDRESSES = {
  base: '0xAdf3d339B1030ac84fa56430C6a86455fBCEA5cd',
  ink: '0xcaf3D13E55fc7c62c1fea07dcD3FbA0D682080Ab',
  baseSepolia: process.env.TESTNET_PROXY,
  inkSepolia: process.env.TESTNET_PROXY,
};

async function main() {
  const proxyAddress = PROXY_ADDRESSES[network.name];
  if (!proxyAddress) {
    throw new Error(`No proxy address configured for network: ${network.name}`);
  }

  const [deployer] = await ethers.getSigners();
  console.log(`\nUpgrading BasePress V2 → V3 on ${network.name}`);
  console.log(`  Proxy:    ${proxyAddress}`);
  console.log(`  Deployer: ${deployer.address}`);

  const implBefore = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`  Impl (before): ${implBefore}`);

  const BasePressV3 = await ethers.getContractFactory('BasePressV3');

  await upgrades.validateUpgrade(proxyAddress, BasePressV3, { kind: 'uups' });
  console.log('  Storage layout validation PASSED');

  const v3 = await upgrades.upgradeProxy(proxyAddress, BasePressV3);
  await v3.waitForDeployment();

  const implAfter = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`  Impl (after):  ${implAfter}`);

  const name = await v3.name();
  const owner = await v3.owner();
  console.log(`  name():  ${name}`);
  console.log(`  owner(): ${owner}`);

  console.log('\nUpgrade complete. Verify the new implementation:');
  console.log(`  npx hardhat verify --network ${network.name} ${implAfter}`);
}

main().catch((err) => {
  console.error('UPGRADE FAILED:', err.message);
  process.exit(1);
});
