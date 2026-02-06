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

async function fetchRaffleHistoryFromSubgraph(
  id: string,
  signal?: AbortSignal
): Promise<RaffleHistory | null> {
  const raffleId = id.toLowerCase();
  const url = mustEnv("VITE_SUBGRAPH_URL");

  // NOTE: Leaving $id: ID! as you had it, since you said this version worked.
  // If your Graph endpoint actually requires Bytes!, switch it.
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

      const historyP: Promise<RaffleHistory | null> = fetchRaffleHistoryFromSubgraph(
        normalizedAddress,
        ac.signal
      ).catch(() => null);

      try {
        // --- Reads (with broader candidates so we don’t fall back to 0 on “new” raffles) ---
        const name = await readFirstOr(contract, "name", ["function name() view returns (string)"], "Unknown raffle");

        const statusU8 = await readFirstOr(contract, "status", ["function status() view returns (uint8)"], 255);

        // ✅ IMPORTANT: some versions expose sold() instead of getSold()
        const sold = await readFirstOr(
          contract,
          "sold",
          ["function getSold() view returns (uint256)", "function sold() view returns (uint256)"],
          0n
        );

        const ticketPrice = await readFirstOr(
          contract,
          "ticketPrice",
          ["function ticketPrice() view returns (uint256)"],
          0n
        );

        const winningPot = await readFirstOr(
          contract,
          "winningPot",
          ["function winningPot() view returns (uint256)"],
          0n
        );

        const minTickets = await readFirstOr(
          contract,
          "minTickets",
          ["function minTickets() view returns (uint64)"],
          0
        );

        const maxTickets = await readFirstOr(
          contract,
          "maxTickets",
          ["function maxTickets() view returns (uint64)"],
          0
        );

        const deadline = await readFirstOr(contract, "deadline", ["function deadline() view returns (uint64)"], 0);

        const paused = await readFirstOr(contract, "paused", ["function paused() view returns (bool)"], false);

        // ✅ IMPORTANT: your ecosystem sometimes uses usdc() not usdcToken()
        const usdcToken = await readFirstOr(
          contract,
          "usdcToken",
          ["function usdcToken() view returns (address)", "function usdc() view returns (address)"],
          ZERO
        );

        // ✅ IMPORTANT: sometimes creator is owner()
        const creator = await readFirstOr(
          contract,
          "creator",
          ["function creator() view returns (address)", "function owner() view returns (address)"],
          ZERO
        );

        const winner = await readFirstOr(contract, "winner", ["function winner() view returns (address)"], ZERO);

        const winningTicketIndex = await readFirstOr(
          contract,
          "winningTicketIndex",
          ["function winningTicketIndex() view returns (uint256)"],
          0n
        );

        const feeRecipient = await readFirstOr(
          contract,
          "feeRecipient",
          ["function feeRecipient() view returns (address)"],
          ZERO
        );

        const protocolFeePercent = await readFirstOr(
          contract,
          "protocolFeePercent",
          ["function protocolFeePercent() view returns (uint256)"],
          0n
        );

        const ticketRevenue = await readFirstOr(
          contract,
          "ticketRevenue",
          ["function ticketRevenue() view returns (uint256)"],
          0n
        );

        const minPurchaseAmount = await readFirstOr(
          contract,
          "minPurchaseAmount",
          ["function minPurchaseAmount() view returns (uint32)"],
          1
        );

        // request IDs vary
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

        const entropyProvider = await readFirstOr(
          contract,
          "entropyProvider",
          ["function entropyProvider() view returns (address)"],
          ZERO
        );

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

        const history = await historyP;
        if (!alive) return;

        const onchainStatus = statusFromUint8(Number(statusU8));
        const subgraphStatus = statusFromSubgraph(history?.status);

        // Prefer terminal-ish subgraph statuses when present
        const finalStatus: RaffleStatus =
          subgraphStatus === "CANCELED" ||
          subgraphStatus === "COMPLETED" ||
          subgraphStatus === "DRAWING"
            ? subgraphStatus
            : onchainStatus;

        setData({
          address: normalizedAddress,
          name: String(name),
          status: finalStatus,

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

          history: history ?? undefined,
        });

        // Helpful hint if we’re clearly falling back
        if (String(name) === "Unknown raffle" || String(usdcToken).toLowerCase() === ZERO) {
          setNote("Some live fields could not be read yet, but the raffle is reachable.");
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
      } catch {
        // ignore
      }
    };
  }, [open, contract, normalizedAddress]);

  return { data, loading, note };
}