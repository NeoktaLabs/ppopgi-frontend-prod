// src/config/contracts.ts

import LotteryRegistryAbi from "./abis/LotteryRegistry.json";
import SingleWinnerDeployerAbi from "./abis/SingleWinnerDeployer.json";
import SingleWinnerLotteryAbi from "./abis/SingleWinnerLottery.json";

export const ADDRESSES = {
  LotteryRegistry: "0xa916e20AbF4d57bCb98f7A845eb74f2EB4Dcbed2",
  SingleWinnerDeployer: "0xAd0c8Ba0E4e519B4EA97cE945A20E2716dDbDf7D",
  USDC: "0x796Ea11Fa2dD751eD01b53C372fFDB4AAa8f00F9",
} as const;

export const ABIS = {
  LotteryRegistry: LotteryRegistryAbi,
  SingleWinnerDeployer: SingleWinnerDeployerAbi,
  SingleWinnerLottery: SingleWinnerLotteryAbi,
} as const;