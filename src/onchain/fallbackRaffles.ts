// src/onchain/fallbackRaffles.ts
import { Contract, JsonRpcProvider, ZeroAddress } from "ethers";
import { ADDRESSES } from "../config/contracts";
import LotteryRegistryAbi from "../config/abis/LotteryRegistry.json";
import LotterySingleWinnerAbi from "../config/abis/LotterySingleWinnerV2.json";
import type { RaffleListItem, RaffleStatus } from "../indexer/subgraph";

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}

function statusFromUint8(x: number): RaffleStatus {
  if (x === 0) return "FUNDING_PENDING";
  if (x === 1) return "OPEN";
  if (x === 2) return "DRAWING";
  if (x === 3) return "COMPLETED";
  return "CANCELED";
}

const ZERO_TX =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

async function safeCall<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function fetchRafflesOnChainFallback(limit = 120): Promise<RaffleListItem[]> {
  const rpcUrl = mustEnv("VITE_ETHERLINK_RPC_URL");

  const rpc = new JsonRpcProvider(rpcUrl);
  const reg = new Contract(ADDRESSES.LotteryRegistry, LotteryRegistryAbi, rpc);

  const [countBn, latestBlock] = await Promise.all([
    reg.getAllLotteriesCount(),
    rpc.getBlockNumber(),
  ]);
  const count = Number(countBn);

  const pageSize = 25;
  const maxToLoad = Math.min(limit, count);

  // newest slice
  const start = Math.max(0, count - maxToLoad);
  const addrs: string[] = [];

  for (let i = start; i < count; i += pageSize) {
    const page = await reg.getAllLotteries(i, Math.min(pageSize, count - i));
    for (const a of page as string[]) addrs.push(a);
  }

  // show newest first
  addrs.reverse();

  const nowSec = String(Math.floor(Date.now() / 1000));
  const nowBlock = String(latestBlock);

  const out: RaffleListItem[] = [];

  for (const addr of addrs) {
    const raffle = new Contract(addr, LotterySingleWinnerAbi, rpc);

    // Best-effort reads (fallbacks are safe)
    const [
      name,
      statusU8,
      winningPot,
      ticketPrice,
      deadline,
      sold,
      minTickets,
      maxTickets,
      protocolFeePercent,
      feeRecipient,
      deployer,
      creator,

      usdc,
      entropy,
      entropyProvider,
      callbackGasLimit,
      minPurchaseAmount,

      ticketRevenue,
      paused,

      // optional lifecycle fields (may exist, but we won't rely)
      winner,
      selectedProvider,
      finalizedAt,
      completedAt,
      canceledAt,
      canceledReason,
      soldAtCancel,
      finalizeRequestId,
      winningTicketIndex,
    ] = await Promise.all([
      safeCall(raffle.name(), ""),
      safeCall(raffle.status(), 0),
      safeCall(raffle.winningPot(), 0n as any),
      safeCall(raffle.ticketPrice(), 0n as any),
      safeCall(raffle.deadline(), 0n as any),
      safeCall(raffle.getSold(), 0n as any),

      safeCall(raffle.minTickets(), 0n as any),
      safeCall(raffle.maxTickets(), 0n as any),

      safeCall(raffle.protocolFeePercent(), 0n as any),
      safeCall(raffle.feeRecipient(), ZeroAddress),
      safeCall(raffle.deployer(), ZeroAddress),
      safeCall(raffle.creator(), ZeroAddress),

      safeCall(raffle.usdcToken?.(), ZeroAddress),
      safeCall(raffle.entropy?.(), ZeroAddress),
      safeCall(raffle.entropyProvider?.(), ZeroAddress),
      safeCall(raffle.callbackGasLimit?.(), 0),
      safeCall(raffle.minPurchaseAmount?.(), 0),

      safeCall(raffle.ticketRevenue?.(), 0n as any),
      safeCall(raffle.paused?.(), false),

      safeCall(raffle.winner?.(), null),
      safeCall(raffle.entropyRequestId?.(), null),
      safeCall(raffle.selectedProvider?.(), null),
      safeCall(raffle.finalizedAt?.(), null),
      safeCall(raffle.completedAt?.(), null),
      safeCall(raffle.canceledAt?.(), null),
      safeCall(raffle.canceledReason?.(), null),
      safeCall(raffle.soldAtCancel?.(), null),
      safeCall(raffle.finalizeRequestId?.(), null),
      safeCall(raffle.winningTicketIndex?.(), null),
    ]);

    out.push({
      id: addr,
      name: String(name || ""), // if empty, your UI can label it "Unnamed"
      status: statusFromUint8(Number(statusU8)),

      // canonical discovery (unknown in fallback)
      deployer: String(deployer),
      registry: null,
      typeId: null,
      registryIndex: null,
      isRegistered: false,
      registeredAt: null,

      // creation metadata (best-effort)
      creator: String(creator),
      createdAtBlock: "0",
      createdAtTimestamp: String(await safeCall(raffle.createdAt?.(), 0)),
      creationTx: ZERO_TX,

      // config / contracts
      usdc: String(usdc),
      entropy: String(entropy),
      entropyProvider: String(entropyProvider),
      feeRecipient: String(feeRecipient),
      protocolFeePercent: protocolFeePercent.toString(),
      callbackGasLimit: String(callbackGasLimit),
      minPurchaseAmount: String(minPurchaseAmount),

      // economics
      winningPot: winningPot.toString(),
      ticketPrice: ticketPrice.toString(),
      deadline: deadline.toString(),
      minTickets: minTickets.toString(),
      maxTickets: maxTickets.toString(),

      // lifecycle / state
      sold: sold.toString(),
      ticketRevenue: ticketRevenue.toString(),
      paused: Boolean(paused),

      finalizeRequestId: finalizeRequestId ? String(finalizeRequestId) : null,
      finalizedAt: finalizedAt ? String(finalizedAt) : null,
      selectedProvider: selectedProvider ? String(selectedProvider) : null,

      winner: winner ? String(winner) : null,
      winningTicketIndex: winningTicketIndex ? String(winningTicketIndex) : null,
      completedAt: completedAt ? String(completedAt) : null,

      canceledReason: canceledReason ? String(canceledReason) : null,
      canceledAt: canceledAt ? String(canceledAt) : null,
      soldAtCancel: soldAtCancel ? String(soldAtCancel) : null,

      // indexing metadata (synthetic)
      lastUpdatedBlock: nowBlock,
      lastUpdatedTimestamp: nowSec,
    });
  }

  return out;
}