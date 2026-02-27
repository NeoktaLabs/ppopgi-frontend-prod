// src/onchain/fallbackLotteries.ts
import { Contract, JsonRpcProvider, ZeroAddress } from "ethers";
import { ADDRESSES } from "../config/contracts";
import { LotteryRegistryABI, SingleWinnerLotteryABI } from "../config/abis";
import type { LotteryListItem, LotteryStatus } from "../indexer/subgraph";

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}

function statusFromUint8(x: number): LotteryStatus {
  if (x === 0) return "FUNDING_PENDING";
  if (x === 1) return "OPEN";
  if (x === 2) return "DRAWING";
  if (x === 3) return "COMPLETED";
  return "CANCELED";
}

async function safeCall<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function fetchLotteriesOnChainFallback(limit = 120): Promise<LotteryListItem[]> {
  const rpcUrl = mustEnv("VITE_ETHERLINK_RPC_URL");

  const rpc = new JsonRpcProvider(rpcUrl);
  const reg = new Contract(ADDRESSES.LotteryRegistry, LotteryRegistryABI as any, rpc);

  const [countBn, latestBlock] = await Promise.all([
    safeCall(reg.getAllLotteriesCount(), 0n as any),
    safeCall(rpc.getBlockNumber(), 0),
  ]);

  // sanity clamp
  const count = Math.max(0, Math.min(Number(countBn ?? 0), 50_000));

  const pageSize = 25;
  const maxToLoad = Math.min(limit, count);

  const start = Math.max(0, count - maxToLoad);
  const addrs: string[] = [];

  for (let i = start; i < count; i += pageSize) {
    const page = await safeCall(
      reg.getAllLotteries(i, Math.min(pageSize, count - i)),
      [] as string[]
    );
    for (const a of page as string[]) addrs.push(String(a));
  }

  // newest first
  addrs.reverse();

  // minimal per-lottery reads
  const lotteries = addrs.map((addr) => new Contract(addr, SingleWinnerLotteryABI as any, rpc));

  const statuses = await Promise.all(lotteries.map((c) => safeCall<unknown>(c.status?.(), 0)));

  const solds = await Promise.all(
    lotteries.map((c) =>
      safeCall<unknown>((c.getSold ? c.getSold() : c.sold?.()) as Promise<unknown>, 0n)
    )
  );

  void latestBlock;

  const out: LotteryListItem[] = [];

  for (let i = 0; i < addrs.length; i++) {
    const addr = addrs[i];
    const statusU8 = Number(statuses[i] as any);
    const sold = solds[i] as any;

    out.push({
      id: addr.toLowerCase(),
      name: null,

      status: statusFromUint8(Number.isFinite(statusU8) ? statusU8 : 0),

      typeId: "1",
      creator: ZeroAddress.toLowerCase(),
      registeredAt: "0",
      registryIndex: null,

      deployedBy: null,
      deployedAt: null,
      deployedTx: null,

      usdcToken: ADDRESSES.USDC.toLowerCase(),
      feeRecipient: ZeroAddress.toLowerCase(),
      entropy: ZeroAddress.toLowerCase(),
      entropyProvider: ZeroAddress.toLowerCase(),
      callbackGasLimit: null,
      protocolFeePercent: null,

      createdAt: null,
      deadline: null,
      ticketPrice: null,
      winningPot: null,
      minTickets: null,
      maxTickets: null,
      minPurchaseAmount: null,

      sold: sold?.toString?.() ?? "0",
      ticketRevenue: "0",

      winner: null,
      selectedProvider: null,
      entropyRequestId: null,
      drawingRequestedAt: null,
      soldAtDrawing: null,

      canceledAt: null,
      soldAtCancel: null,
      cancelReason: null,
      creatorPotRefunded: null,

      totalReservedUSDC: null,
    });
  }

  return out;
}