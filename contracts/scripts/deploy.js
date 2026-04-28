const { ethers, upgrades, network } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = process.env.OWNER || deployer.address;
  const platformSigner = process.env.PLATFORM_SIGNER || deployer.address;
  const platformTreasury = process.env.PLATFORM_TREASURY || deployer.address;
  const platformFeeBps = parseInt(process.env.PLATFORM_FEE_BPS || '500', 10); // 5%
  const blogName = process.env.BLOG_NAME || 'BasePress';
  const baseUri = process.env.BASE_URI || 'https://api.basepress.app/metadata/{id}';

  console.log(`\nDeploying BasePress to ${network.name} (chainId ${network.config.chainId})`);
  console.log(`  deployer:        ${deployer.address}`);
  console.log(`  owner:           ${owner}`);
  console.log(`  platformSigner:  ${platformSigner}`);
  console.log(`  platformTreasury:${platformTreasury}`);
  console.log(`  platformFeeBps:  ${platformFeeBps}`);

  const BasePress = await ethers.getContractFactory('BasePress');
  const proxy = await upgrades.deployProxy(
    BasePress,
    [owner, platformSigner, platformTreasury, platformFeeBps, blogName, baseUri],
    { kind: 'uups', initializer: 'initialize' },
  );
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log(`\nDeployed.`);
  console.log(`  Proxy:          ${proxyAddress}`);
  console.log(`  Implementation: ${implAddress}`);
  console.log(`\nNext: add to apps/web/app/lib/contract.ts → CONTRACT_ADDRESSES.${network.name} = '${proxyAddress}'`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
