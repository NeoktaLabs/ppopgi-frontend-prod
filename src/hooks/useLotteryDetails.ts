// src/hooks/useLotteryDetails.ts

import { useEffect, useMemo, useRef, useState } from "react";
import { getContract, readContract } from "thirdweb";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import { getAddress } from "ethers";
import { SingleWinnerLotteryABI } from "../config/abis";

export type LotteryStatus =
  | "FUNDING_PENDING"
  | "OPEN"
  | "DRAWING"
  | "COMPLETED"
  | "CANCELED"
  | "UNKNOWN";

function statusFromUint8(n: number): LotteryStatus {
  if (n === 0) return "FUNDING_PENDING";
  if (n === 1) return "OPEN";
  if (n === 2) return "DRAWING";
  if (n === 3) return "COMPLETED";
  if (n === 4) return "CANCELED";
  return "UNKNOWN";
}

// subgraph may return int (0..4) or string labels depending on tooling
function statusFromSubgraph(v: any): LotteryStatus {
  if (typeof v === "number") return statusFromUint8(v);
  const n = Number(v);
  if (Number.isFinite(n)) return statusFromUint8(n);

  const s = String(v || "").toUpperCase().trim();
  if (s === "FUNDING_PENDING") return "FUNDING_PENDING";
  if (s === "OPEN") return "OPEN";
  if (s === "DRAWING") return "DRAWING";
  if (s === "COMPLETED") return "COMPLETED";
  if (s === "CANCELED") return "CANCELED";
  return "UNKNOWN";
}

const ZERO = "0x0000000000000000000000000000000000000000";

function normHex(v: unknown): string {
  return String(v || "").toLowerCase();
}

type LotteryHistory = {
  status?: string | number | null;

  createdAt?: string | null;
  deployedAt?: string | null;
  deployedTx?: string | null;

  drawingRequestedAt?: string | null;
  soldAtDrawing?: string | null;
  entropyRequestId?: string | null;
  selectedProvider?: string | null;
  winner?: string | null;

  canceledAt?: string | null;
  soldAtCancel?: string | null;
  cancelReason?: string | null;
  creatorPotRefunded?: boolean | null;

  registryIndex?: string | null;
  registeredAt?: string | null;
};

export type LotteryDetails = {
  address: string;

  name: string;
  status: LotteryStatus;

  sold: string;
  ticketRevenue: string;

  ticketPrice: string;
  winningPot: string;

  minTickets: string;
  maxTickets: string;
  deadline: string;

  // legacy field kept for UI compatibility (contract has no paused())
  paused: boolean;

  minPurchaseAmount: string;

  // entropy/draw state
  entropyRequestId: string;
  drawingRequestedAt: string;
  selectedProvider: string;
  winner: string;

  // derived UX helpers from getSummary()
  isFinalizable: boolean;
  isHatchOpen: boolean;

  // config (from subgraph; immutables on-chain but no need to hammer RPC)
  usdcToken: string;
  creator: string;
  feeRecipient: string;
  protocolFeePercent: string;
  entropy: string;
  entropyProvider: string;
  callbackGasLimit: string;

  // this is NOT a contract getter — we take it from WinnerPickedEvent in subgraph
  winningTicketIndex: string;

  history?: LotteryHistory;
};

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

type SubgraphBundle = {
  core: {
    name: string | null;
    creator: string | null;
    usdcToken: string | null;

    feeRecipient: string | null;
    protocolFeePercent: string | null;

    entropy: string | null;
    entropyProvider: string | null;
    callbackGasLimit: string | null;

    ticketPrice: string | null;
    winningPot: string | null;
    minTickets: string | null;
    maxTickets: string | null;
    deadline: string | null;
    ticketRevenue: string | null;

    status: any;
  } | null;

  history: LotteryHistory | null;

  latestWinnerPicked: { winningTicketIndex: string | null } | null;
};

async function fetchSubgraphBundle(id: string, signal?: AbortSignal): Promise<SubgraphBundle> {
  const lotteryId = id.toLowerCase();
  const url = mustEnv("VITE_SUBGRAPH_URL");

  /**
   * ✅ IMPORTANT:
   * Your schema has `Lottery.id: ID!` (string), NOT Bytes.
   * So the query variable must be `$id: ID!` and you pass the lowercased address string.
   */
  const query = `
    query LotteryDetailsBundle($id: ID!) {
      lottery(id: $id) {
        id
        name
        status

        creator
        usdcToken
        feeRecipient
        protocolFeePercent

        entropy
        entropyProvider
        callbackGasLimit

        ticketPrice
        winningPot
        minTickets
        maxTickets
        deadline
        ticketRevenue

        createdAt
        deployedAt
        deployedTx

        drawingRequestedAt
        soldAtDrawing
        entropyRequestId
        selectedProvider
        winner

        canceledAt
        soldAtCancel
        cancelReason
        creatorPotRefunded

        registryIndex
        registeredAt
      }

      winnerPickedEvents(
        first: 1
        orderBy: timestamp
        orderDirection: desc
        where: { lottery: $id }
      ) {
        winningTicketIndex
      }
    }
  `;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { id: lotteryId } }),
    signal,
  });

  if (!res.ok) throw new Error(`SUBGRAPH_HTTP_ERROR_${res.status}`);
  const json = await res.json().catch(() => null);
  if (json?.errors?.length) throw new Error("SUBGRAPH_GQL_ERROR");

  const lot = json?.data?.lottery ?? null;
  const w = (json?.data?.winnerPickedEvents?.[0] ?? null) as { winningTicketIndex?: any } | null;

  const history: LotteryHistory | null = lot
    ? {
        status: lot.status ?? null,

        createdAt: lot.createdAt ?? null,
        deployedAt: lot.deployedAt ?? null,
        deployedTx: lot.deployedTx != null ? normHex(lot.deployedTx) : null,

        drawingRequestedAt: lot.drawingRequestedAt ?? null,
        soldAtDrawing: lot.soldAtDrawing ?? null,
        entropyRequestId: lot.entropyRequestId ?? null,
        selectedProvider: lot.selectedProvider != null ? normHex(lot.selectedProvider) : null,
        winner: lot.winner != null ? normHex(lot.winner) : null,

        canceledAt: lot.canceledAt ?? null,
        soldAtCancel: lot.soldAtCancel ?? null,
        cancelReason: lot.cancelReason ?? null,
        creatorPotRefunded: typeof lot.creatorPotRefunded === "boolean" ? lot.creatorPotRefunded : null,

        registryIndex: lot.registryIndex ?? null,
        registeredAt: lot.registeredAt ?? null,
      }
    : null;

  return {
    core: lot
      ? {
          name: lot.name ?? null,
          creator: lot.creator ?? null,
          usdcToken: lot.usdcToken ?? null,

          feeRecipient: lot.feeRecipient ?? null,
          protocolFeePercent: lot.protocolFeePercent ?? null,

          entropy: lot.entropy ?? null,
          entropyProvider: lot.entropyProvider ?? null,
          callbackGasLimit: lot.callbackGasLimit ?? null,

          ticketPrice: lot.ticketPrice ?? null,
          winningPot: lot.winningPot ?? null,
          minTickets: lot.minTickets ?? null,
          maxTickets: lot.maxTickets ?? null,
          deadline: lot.deadline ?? null,
          ticketRevenue: lot.ticketRevenue ?? null,

          status: lot.status,
        }
      : null,

    history,
    latestWinnerPicked: w
      ? { winningTicketIndex: w.winningTicketIndex != null ? String(w.winningTicketIndex) : null }
      : null,
  };
}

// Very small in-memory TTL cache to avoid refetch when user opens/closes quickly
type CacheEntry = { ts: number; data: LotteryDetails };
const DETAILS_CACHE_TTL_MS = 7_500;
const detailsCache = new Map<string, CacheEntry>();

export function useLotteryDetails(lotteryAddress: string | null, open: boolean) {
  const [data, setData] = useState<LotteryDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // used to ignore stale async results
  const runIdRef = useRef(0);

  const normalizedAddress = useMemo(() => {
    if (!lotteryAddress) return null;
    try {
      return getAddress(lotteryAddress);
    } catch {
      return lotteryAddress;
    }
  }, [lotteryAddress]);

  const contract = useMemo(() => {
    if (!normalizedAddress) return null;
    return getContract({
      client: thirdwebClient,
      chain: ETHERLINK_CHAIN,
      address: normalizedAddress,
      abi: SingleWinnerLotteryABI as any,
    });
  }, [normalizedAddress]);

  useEffect(() => {
    if (!open || !contract || !normalizedAddress) return;

    // Serve hot cache immediately (no RPC)
    const cacheKey = normalizedAddress.toLowerCase();
    const cached = detailsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < DETAILS_CACHE_TTL_MS) {
      setData(cached.data);
      setLoading(false);
      setNote(null);
      return;
    }

    const runId = ++runIdRef.current;
    let alive = true;
    const ac = new AbortController();

    (async () => {
      setLoading(true);
      setNote(null);

      // Start subgraph in parallel (fast, cached by your worker)
      const subgraphP = withTimeout(fetchSubgraphBundle(cacheKey, ac.signal).catch(() => null), 2500, null);

      try {
        /**
         * ✅ BEST on-chain trust with MIN calls:
         * 1 RPC: getSummary()
         *
         * getSummary returns:
         * (_status,_name,_createdAt,_deadline,_ticketPrice,_winningPot,_ticketRevenue,_minTickets,_maxTickets,_minPurchaseAmount,_sold,_winner,_entropyRequestId,_drawingRequestedAt,_selectedProvider,_isFinalizable,_isHatchOpen)
         */
        const summary = await withTimeout(
          readContract({
            contract,
            method: "getSummary",
            params: [],
          }).catch(() => null),
          4000,
          null
        );

        // Parse summary defensively
        const s = Array.isArray(summary) ? summary : null;

        const onchainStatus = s ? statusFromUint8(Number(s[0])) : "UNKNOWN";
        const onchainName = s ? String(s[1] ?? "Lottery") : "Lottery";
        const onchainDeadline = s ? String(s[3] ?? "0") : "0";
        const onchainTicketPrice = s ? String(s[4] ?? "0") : "0";
        const onchainWinningPot = s ? String(s[5] ?? "0") : "0";
        const onchainTicketRevenue = s ? String(s[6] ?? "0") : "0";
        const onchainMinTickets = s ? String(s[7] ?? "0") : "0";
        const onchainMaxTickets = s ? String(s[8] ?? "0") : "0";
        const onchainMinPurchaseAmount = s ? String(s[9] ?? "0") : "0";
        const onchainSold = s ? String(s[10] ?? "0") : "0";
        const onchainWinner = s ? normHex(s[11] ?? ZERO) : ZERO;
        const onchainEntropyRequestId = s ? String(s[12] ?? "0") : "0";
        const onchainDrawingRequestedAt = s ? String(s[13] ?? "0") : "0";
        const onchainSelectedProvider = s ? normHex(s[14] ?? ZERO) : ZERO;
        const onchainIsFinalizable = s ? Boolean(s[15]) : false;
        const onchainIsHatchOpen = s ? Boolean(s[16]) : false;

        if (!alive || runId !== runIdRef.current) return;

        // Build initial view using on-chain summary (truth) + placeholders for config
        const base: LotteryDetails = {
          address: normalizedAddress,

          name: onchainName,
          status: onchainStatus,

          sold: onchainSold,
          ticketRevenue: onchainTicketRevenue,

          ticketPrice: onchainTicketPrice,
          winningPot: onchainWinningPot,

          minTickets: onchainMinTickets,
          maxTickets: onchainMaxTickets,
          deadline: onchainDeadline,

          paused: false, // contract has no paused()

          minPurchaseAmount: onchainMinPurchaseAmount,

          entropyRequestId: onchainEntropyRequestId,
          drawingRequestedAt: onchainDrawingRequestedAt,
          selectedProvider: onchainSelectedProvider,
          winner: onchainWinner,

          isFinalizable: onchainIsFinalizable,
          isHatchOpen: onchainIsHatchOpen,

          // config comes from subgraph (immutables on-chain, but not worth extra RPC here)
          usdcToken: ZERO,
          creator: ZERO,
          feeRecipient: ZERO,
          protocolFeePercent: "0",
          entropy: ZERO,
          entropyProvider: ZERO,
          callbackGasLimit: "0",

          // NOT a contract getter; take from subgraph event
          winningTicketIndex: "0",

          history: undefined,
        };

        // Set immediately so UI is responsive even if subgraph lags
        setData(base);

        // Merge subgraph if/when available
        const bundle = await subgraphP;
        if (!alive || runId !== runIdRef.current) return;

        if (bundle?.core) {
          const subStatus = statusFromSubgraph(bundle.core.status);
          const finalStatus: LotteryStatus =
            subStatus === "CANCELED" || subStatus === "COMPLETED" || subStatus === "DRAWING"
              ? subStatus
              : onchainStatus;

          const merged: LotteryDetails = {
            ...base,

            // Prefer subgraph name if present (but keep on-chain if not)
            name: bundle.core.name ? String(bundle.core.name) : base.name,

            // Prefer subgraph config (immutables)
            creator: bundle.core.creator ? normHex(bundle.core.creator) : base.creator,
            usdcToken: bundle.core.usdcToken ? normHex(bundle.core.usdcToken) : base.usdcToken,
            feeRecipient: bundle.core.feeRecipient ? normHex(bundle.core.feeRecipient) : base.feeRecipient,
            protocolFeePercent:
              bundle.core.protocolFeePercent != null ? String(bundle.core.protocolFeePercent) : base.protocolFeePercent,
            entropy: bundle.core.entropy ? normHex(bundle.core.entropy) : base.entropy,
            entropyProvider: bundle.core.entropyProvider ? normHex(bundle.core.entropyProvider) : base.entropyProvider,
            callbackGasLimit:
              bundle.core.callbackGasLimit != null ? String(bundle.core.callbackGasLimit) : base.callbackGasLimit,

            // Prefer subgraph for these if you want “what the indexer thinks”, but keep on-chain truth for actions:
            ticketPrice: bundle.core.ticketPrice != null ? String(bundle.core.ticketPrice) : base.ticketPrice,
            winningPot: bundle.core.winningPot != null ? String(bundle.core.winningPot) : base.winningPot,
            minTickets: bundle.core.minTickets != null ? String(bundle.core.minTickets) : base.minTickets,
            maxTickets: bundle.core.maxTickets != null ? String(bundle.core.maxTickets) : base.maxTickets,
            deadline: bundle.core.deadline != null ? String(bundle.core.deadline) : base.deadline,
            ticketRevenue: bundle.core.ticketRevenue != null ? String(bundle.core.ticketRevenue) : base.ticketRevenue,

            // Final status: allow subgraph to “win” only for terminal/drawing states
            status: finalStatus,

            // event-derived
            winningTicketIndex: bundle.latestWinnerPicked?.winningTicketIndex ?? base.winningTicketIndex,

            history: bundle.history ?? undefined,
          };

          setData(merged);
          detailsCache.set(cacheKey, { ts: Date.now(), data: merged });
          setNote(null);
          return;
        }

        // If subgraph unavailable, keep the on-chain view but warn
        detailsCache.set(cacheKey, { ts: Date.now(), data: base });
        setNote("Showing on-chain summary only. Indexer details are still syncing or unavailable.");
      } catch {
        if (!alive || runId !== runIdRef.current) return;
        setData(null);
        setNote("Could not load this lottery right now. Please refresh (and check console logs).");
      } finally {
        if (!alive || runId !== runIdRef.current) return;
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