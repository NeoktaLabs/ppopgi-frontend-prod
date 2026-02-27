// src/config/transparency.ts

export const CONTRACTS = {
  registry: "0xa916e20AbF4d57bCb98f7A845eb74f2EB4Dcbed2",
  deployer: "0xAd0c8Ba0E4e519B4EA97cE945A20E2716dDbDf7D",
  usdc: "0x796Ea11Fa2dD751eD01b53C372fFDB4AAa8f00F9",
  pythEntropy: "0x23f0e8faee7bbb405e7a7c3d60138fcfd43d7509",
  entropyProvider: "0x52DeaA1c84233F7bb8C8A45baeDE41091c616506",
};

export const LINKS = {
  explorerBase: "https://explorer.etherlink.com",

  // SolidityScan quickscan links
  solidityScanRegistry:
    "https://solidityscan.com/quickscan/0xa916e20AbF4d57bCb98f7A845eb74f2EB4Dcbed2/blockscout/etherlink-mainnet",
  solidityScanDeployer:
    "https://solidityscan.com/quickscan/0xAd0c8Ba0E4e519B4EA97cE945A20E2716dDbDf7D/blockscout/etherlink-mainnet",

  // Optional: add when ready (leave "" if not public yet)
  repoFrontend: "https://github.com/NeoktaLabs/ppopgi-frontend-prod",
  repoContracts: "https://github.com/NeoktaLabs/ppopgi-smartcontracts",
  repoFinalizerBot: "https://github.com/NeoktaLabs/ppopgi-finalizer-bot",

  // Optional: one “Transparency” link you might add later
  // transparencyPage: "?page=transparency",
};

export function explorerAddressUrl(addr: string) {
  return `${LINKS.explorerBase}/address/${String(addr || "").toLowerCase()}`;
}