// src/hooks/useRaffleDetails.ts
import { useEffect, useMemo, useState } from "react";
import { getContract, readContract } from "thirdweb";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import { getAddress } from "ethers";

export type RaffleStatus =
  | "FUNDING_PENDING"
  | "OPEN"
  | "DRAWING"
  | "COMPLETED"
  | "CANCELED"
  | "UNKNOWN";

function statusFromUint8(n: number): RaffleStatus {
  if (n === 0) return "FUNDING_PENDING";
  if (n === 1) return "OPEN";
  if (n === 2) return "DRAWING";
  if (n === 3) return "COMPLETED";
  if (n === 4) return "CANCELED";
  return "UNKNOWN";
}

function statusFromSubgraph(v: any): RaffleStatus {
  const s = String(v || "").toUpperCase().trim();
  if (s === "FUNDING_PENDING") return "FUNDING_PENDING";
  if (s === "OPEN") return "OPEN";
  if (s === "DRAWING") return "DRAWING";
  if (s === "COMPLETED") return "COMPLETED";
  if (s === "CANCELED") return "CANCELED";
  return "UNKNOWN";
}

const ZERO = "0x0000000000000000000000000000000000000000";

type RaffleHistory = {
  status?: string | null;

  createdAtTimestamp?: string | null;
  creationTx?: string | null;

  finalizedAt?: string | null;
  completedAt?: string | null;

  canceledAt?: string | null;
  canceledReason?: string | null;
  soldAtCancel?: string | null;

  lastUpdatedTimestamp?: string | null;

  registry?: string | null;
  registryIndex?: string | null;
  isRegistered?: boolean | null;
  registeredAt?: string | null;
};

export type RaffleDetails = {
  address: string;

  name: string;
  status: RaffleStatus;

  sold: string;
  ticketRevenue: string;

  ticketPrice: string;
  winningPot: string;

  minTickets: string;
  maxTickets: string;
  deadline: string;
  paused: boolean;

  minPurchaseAmount: string;

  finalizeRequestId: string;
  callbackGasLimit: string;

  usdcToken: string;
  creator: string;

  winner: string;
  winningTicketIndex: string;

  feeRecipient: string;
  protocolFeePercent: string;

  entropy: string;
  entropyProvider: string;
  entropyRequestId: string;
  selectedProvider: string;

  history?: RaffleHistory;
};

async function readFirst(
  contract: any,
  label: string,
  candidates: string[],
  params: readonly unknown[] = []
): Promise<any> {
  let lastErr: any = null;
  for (const method of candidates) {
    try {
      return await readContract({ contract, method, params });
    } catch (e) {
      lastErr = e;
    }
  }
  // eslint-disable-next-line no-console
  console.warn(`[useRaffleDetails] Failed to read ${label}. Tried:`, candidates, lastErr);
  throw lastErr;
}

async function readFirstOr(
  contract: any,
  label: string,
  candidates: string[],
  fallback: any,
  params: readonly unknown[] = []
): Promise<any> {
  try {
    return await readFirst(contract, label, candidates, params);
  } catch {
    return fallback;
  }
}

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: any;
  try {
    return await Promise.race([
      p,
      new Promise<T>((res) => {
        t = setTimeout(() => res(fallback), ms);
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

async function fetchRaffleHistoryFromSubgraph(id: string, signal?: AbortSignal): Promise<RaffleHistory | null> {
  const raffleId = id.toLowerCase();
  const url = mustEnv("VITE_SUBGRAPH_URL");

  const query = `
    query RaffleById($id: ID!) {
      raffle(id: $id) {
        status

        createdAtTimestamp
        creationTx

        finalizedAt
        completedAt

        canceledAt
        canceledReason
        soldAtCancel

        lastUpdatedTimestamp

        registry
        registryIndex
        isRegistered
        registeredAt
      }
    }
  `;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { id: raffleId } }),
    signal,
  });

  if (!res.ok) throw new Error("SUBGRAPH_HTTP_ERROR");
  const json = await res.json();
  if (json?.errors?.length) throw new Error("SUBGRAPH_GQL_ERROR");

  const r = json.data?.raffle;
  if (!r) return null;

  return {
    status: r.status ?? null,

    createdAtTimestamp: r.createdAtTimestamp ?? null,
    creationTx: r.creationTx ?? null,

    finalizedAt: r.finalizedAt ?? null,
    completedAt: r.completedAt ?? null,

    canceledAt: r.canceledAt ?? null,
    canceledReason: r.canceledReason ?? null,
    soldAtCancel: r.soldAtCancel ?? null,

    lastUpdatedTimestamp: r.lastUpdatedTimestamp ?? null,

    registry: r.registry ?? null,
    registryIndex: r.registryIndex ?? null,
    isRegistered: typeof r.isRegistered === "boolean" ? r.isRegistered : null,
    registeredAt: r.registeredAt ?? null,
  };
}

export function useRaffleDetails(raffleAddress: string | null, open: boolean) {
  const [data, setData] = useState<RaffleDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const normalizedAddress = useMemo(() => {
    if (!raffleAddress) return null;
    try {
      return getAddress(raffleAddress);
    } catch {
      return raffleAddress;
    }
  }, [raffleAddress]);

  const contract = useMemo(() => {
    if (!normalizedAddress) return null;
    return getContract({
      client: thirdwebClient,
      chain: ETHERLINK_CHAIN,
      address: normalizedAddress,
    });
  }, [normalizedAddress]);

  useEffect(() => {
    if (!open || !contract || !normalizedAddress) return;

    let alive = true;
    const ac = new AbortController();

    (async () => {
      setLoading(true);
      setNote(null);

      // ✅ Start subgraph fetch, but DO NOT let it block on-chain values
      const historyPromise = withTimeout(
        fetchRaffleHistoryFromSubgraph(normalizedAddress, ac.signal).catch(() => null),
        2500,
        null
      );

      try {
        // ---- On-chain reads first (buy depends on these) ----
        const name = await readFirstOr(contract, "name", ["function name() view returns (string)"], "Unknown raffle");
        const statusU8 = await readFirstOr(contract, "status", ["function status() view returns (uint8)"], 255);

        // ✅ Determine on-chain status early (used to gate some reads)
        const onchainStatus = statusFromUint8(Number(statusU8));

        const sold = await readFirstOr(
          contract,
          "sold",
          ["function getSold() view returns (uint256)", "function sold() view returns (uint256)"],
          0n
        );

        const ticketPrice = await readFirstOr(contract, "ticketPrice", ["function ticketPrice() view returns (uint256)"], 0n);
        const winningPot = await readFirstOr(contract, "winningPot", ["function winningPot() view returns (uint256)"], 0n);

        const minTickets = await readFirstOr(contract, "minTickets", ["function minTickets() view returns (uint64)"], 0);
        const maxTickets = await readFirstOr(contract, "maxTickets", ["function maxTickets() view returns (uint64)"], 0);

        const deadline = await readFirstOr(contract, "deadline", ["function deadline() view returns (uint64)"], 0);
        const paused = await readFirstOr(contract, "paused", ["function paused() view returns (bool)"], false);

        const usdcToken = await readFirstOr(
          contract,
          "usdcToken",
          ["function usdcToken() view returns (address)", "function usdc() view returns (address)"],
          ZERO
        );

        const creator = await readFirstOr(
          contract,
          "creator",
          ["function creator() view returns (address)", "function owner() view returns (address)"],
          ZERO
        );

        const winner = await readFirstOr(contract, "winner", ["function winner() view returns (address)"], ZERO);

        // ✅ FIX: many contracts revert for winningTicketIndex until settled.
        // Gate the read to avoid noisy console warnings + unnecessary RPC calls.
        const winningTicketIndex =
          onchainStatus === "COMPLETED"
            ? await readFirstOr(
                contract,
                "winningTicketIndex",
                ["function winningTicketIndex() view returns (uint256)"],
                0n
              )
            : 0n;

        const feeRecipient = await readFirstOr(contract, "feeRecipient", ["function feeRecipient() view returns (address)"], ZERO);

        const protocolFeePercent = await readFirstOr(
          contract,
          "protocolFeePercent",
          ["function protocolFeePercent() view returns (uint256)"],
          0n
        );

        const ticketRevenue = await readFirstOr(contract, "ticketRevenue", ["function ticketRevenue() view returns (uint256)"], 0n);

        const minPurchaseAmount = await readFirstOr(
          contract,
          "minPurchaseAmount",
          ["function minPurchaseAmount() view returns (uint32)"],
          1
        );

        const finalizeRequestId = await readFirstOr(
          contract,
          "finalizeRequestId",
          ["function finalizeRequestId() view returns (uint64)", "function entropyRequestId() view returns (uint64)"],
          0
        );

        const callbackGasLimit = await readFirstOr(
          contract,
          "callbackGasLimit",
          ["function callbackGasLimit() view returns (uint32)"],
          0
        );

        const entropy = await readFirstOr(contract, "entropy", ["function entropy() view returns (address)"], ZERO);
        const entropyProvider = await readFirstOr(contract, "entropyProvider", ["function entropyProvider() view returns (address)"], ZERO);
        const entropyRequestId = await readFirstOr(
          contract,
          "entropyRequestId",
          ["function entropyRequestId() view returns (uint64)"],
          0
        );
        const selectedProvider = await readFirstOr(
          contract,
          "selectedProvider",
          ["function selectedProvider() view returns (address)"],
          ZERO
        );

        if (!alive) return;

        // ✅ Set data immediately from RPC (buy UI will work even if subgraph is slow/down)
        setData({
          address: normalizedAddress,
          name: String(name),
          status: onchainStatus,

          sold: String(sold),
          ticketRevenue: String(ticketRevenue),

          ticketPrice: String(ticketPrice),
          winningPot: String(winningPot),

          minTickets: String(minTickets),
          maxTickets: String(maxTickets),
          deadline: String(deadline),
          paused: Boolean(paused),

          minPurchaseAmount: String(minPurchaseAmount),
          finalizeRequestId: String(finalizeRequestId),
          callbackGasLimit: String(callbackGasLimit),

          usdcToken: String(usdcToken),
          creator: String(creator),

          winner: String(winner),
          winningTicketIndex: String(winningTicketIndex),

          feeRecipient: String(feeRecipient),
          protocolFeePercent: String(protocolFeePercent),

          entropy: String(entropy),
          entropyProvider: String(entropyProvider),
          entropyRequestId: String(entropyRequestId),
          selectedProvider: String(selectedProvider),

          history: undefined,
        });

        // Helpful hint if critical values are still 0
        if (BigInt(String(ticketPrice || "0")) === 0n) {
          setNote("Live ticket price is still syncing. If it stays 0, check RPC response body (JSON-RPC error).");
        } else {
          setNote(null);
        }

        // ✅ Attach subgraph history later (never blocks buy flow)
        const history = await historyPromise;
        if (!alive) return;

        if (history) {
          const subgraphStatus = statusFromSubgraph(history?.status);
          const finalStatus: RaffleStatus =
            subgraphStatus === "CANCELED" || subgraphStatus === "COMPLETED" || subgraphStatus === "DRAWING"
              ? subgraphStatus
              : onchainStatus;

          setData((prev) => {
            if (!prev) return prev;
            return { ...prev, history, status: finalStatus };
          });
        }
      } catch (e: any) {
        if (!alive) return;
        setData(null);
        setNote("Could not load this raffle right now. Please refresh (and check console logs).");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
      try {
        ac.abort();
      } catch {}
    };
  }, [open, contract, normalizedAddress]);

  return { data, loading, note };
}