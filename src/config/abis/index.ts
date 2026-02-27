// src/config/abis/index.ts

import USDC from "./USDC.json";
import SingleWinnerDeployer from "./SingleWinnerDeployer.json";
import SingleWinnerLottery from "./SingleWinnerLottery.json";
import LotteryRegistry from "./LotteryRegistry.json";

/**
 * Individual exports (preferred for hooks & thirdweb)
 */
export const USDC_ABI = USDC;
export const SingleWinnerDeployerABI = SingleWinnerDeployer;
export const SingleWinnerLotteryABI = SingleWinnerLottery;
export const LotteryRegistryABI = LotteryRegistry;

/**
 * Optional grouped export (nice for dynamic usage)
 */
export const ABIS = {
  USDC: USDC_ABI,
  SingleWinnerDeployer: SingleWinnerDeployerABI,
  SingleWinnerLottery: SingleWinnerLotteryABI,
  LotteryRegistry: LotteryRegistryABI,
} as const;