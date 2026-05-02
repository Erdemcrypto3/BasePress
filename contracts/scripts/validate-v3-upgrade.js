const { ethers, upgrades } = require('hardhat');

async function main() {
  console.log('Validating V2 → V3 upgrade compatibility...\n');

  const BasePress = await ethers.getContractFactory('BasePress');
  const BasePressV3 = await ethers.getContractFactory('BasePressV3');

  await upgrades.validateUpgrade(BasePress, BasePressV3, {
    kind: 'uups',
  });

  console.log('Storage layout validation PASSED — V3 is upgrade-compatible with V2.\n');

  const [deployer] = await ethers.getSigners();
  const proxy = await upgrades.deployProxy(
    BasePress,
    [
      deployer.address,
      deployer.address,
      deployer.address,
      500,
      'BasePress',
      'https://api.basepress.app/metadata/{id}',
    ],
    { kind: 'uups', initializer: 'initialize' },
  );
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  console.log(`  V2 proxy deployed at: ${proxyAddr}`);

  const v3 = await upgrades.upgradeProxy(proxyAddr, BasePressV3);
  await v3.waitForDeployment();
  const implAddr = await upgrades.erc1967.getImplementationAddress(proxyAddr);
  console.log(`  V3 impl deployed at:  ${implAddr}`);
  console.log('\nDry-run upgrade PASSED on local hardhat network.');
}

main().catch((err) => {
  console.error('VALIDATION FAILED:', err.message);
  process.exit(1);
});
