import LotteryRegistryAbi from "./abis/LotteryRegistry.json";
import SingleWinnerDeployerAbi from "./abis/SingleWinnerDeployerV2.json";
import LotterySingleWinnerAbi from "./abis/LotterySingleWinnerV2.json";

export const ADDRESSES = {
  LotteryRegistry: "0x1CD24E0C49b1B61ff07be12fBa3ce58eCb20b098",
  SingleWinnerDeployer: "0xe48da5BCb4E276C508285E0D9B8A9A84Dd9bf704",
  USDC: "0x796Ea11Fa2dD751eD01b53C372fFDB4AAa8f00F9",
} as const;

export const ABIS = {
  LotteryRegistry: LotteryRegistryAbi,
  SingleWinnerDeployer: SingleWinnerDeployerAbi,
  LotterySingleWinner: LotterySingleWinnerAbi,
} as const;