require('@nomicfoundation/hardhat-toolbox');
require('@openzeppelin/hardhat-upgrades');

// Reads deploy key from Windows Credential Manager via the `Rabby-EVM-Deploy`
// (formerly `BasePress-DeployKey`) entry — never from .env. The launching
// script must export DEPLOY_PK before invoking hardhat.
const PK = process.env.DEPLOY_PK;
const accounts = PK ? [PK] : [];

module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    base: {
      url: 'https://mainnet.base.org',
      chainId: 8453,
      accounts,
    },
    ink: {
      url: 'https://rpc-gel.inkonchain.com',
      chainId: 57073,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY || '',
      ink: 'placeholder', // Blockscout — no key needed
    },
    customChains: [
      {
        network: 'ink',
        chainId: 57073,
        urls: {
          apiURL: 'https://explorer.inkonchain.com/api',
          browserURL: 'https://explorer.inkonchain.com',
        },
      },
    ],
  },
};
