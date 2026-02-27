// src/hooks/useLotteryInteraction.ts

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { formatUnits, MaxUint256 } from "ethers";
import { getContract, prepareContractCall, readContract } from "thirdweb";
import { useActiveAccount, useSendAndConfirmTransaction } from "thirdweb/react";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import { useLotteryDetails } from "./useLotteryDetails";
import { useConfetti } from "./useConfetti";
import { ADDRESSES } from "../config/contracts";

// ✅ Use your ABI files (from src/config/abis/index.ts)
import { USDC_ABI, SingleWinnerLotteryABI } from "../config/abis";

const ZERO = "0x0000000000000000000000000000000000000000";
const isZeroAddr = (a: any) => String(a || "").toLowerCase() === ZERO;

function short(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}

function fmtUsdc(raw: string) {
  try {
    return formatUnits(BigInt(raw || "0"), 6);
  } catch {
    return "0";
  }
}

function clampInt(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function toInt(v: string, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fb;
}

function safeTxHash(receipt: any): string {
  return String(
    receipt?.transactionHash || receipt?.hash || receipt?.receipt?.transactionHash || receipt?.receipt?.hash || ""
  ).toLowerCase();
}

// -------------------- App events --------------------

type ActivityDetail = {
  type: "BUY" | "CREATE" | "WIN" | "CANCEL";
  lotteryId: string;
  lotteryName: string;
  subject: string; // buyer/creator/winner
  value: string; // ticket count OR winningPot OR "0"
  timestamp: string; // seconds
  txHash: string;
  pendingLabel?: string;
};

function emitActivity(detail: ActivityDetail) {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("ppopgi:activity", { detail }));
  } catch {}
}

/**
 * Very small in-memory cache for allowance/balance reads.
 * Goal: avoid re-reading when modal reopens quickly or state re-renders.
 */
type AllowBalEntry = { ts: number; allowance?: bigint; bal?: bigint };
const ALLOW_BAL_TTL_MS = 20_000;
const allowBalCache = new Map<string, AllowBalEntry>();

function cacheKey(acct: string, token: string, spender: string) {
  return `${acct.toLowerCase()}:${token.toLowerCase()}:${spender.toLowerCase()}`;
}

function parseTxError(e: any): { label: string; raw: string } {
  const raw =
    String(
      e?.shortMessage ||
        e?.message ||
        e?.cause?.shortMessage ||
        e?.cause?.message ||
        e?.data?.message ||
        e?.reason ||
        ""
    ) || "unknown error";

  const lower = raw.toLowerCase();

  if (lower.includes("user rejected") || lower.includes("rejected")) return { label: "You rejected the transaction.", raw };
  if (lower.includes("insufficient")) return { label: "Not enough USDC.", raw };
  if (lower.includes("batchtoocheap") || lower.includes("too cheap"))
    return { label: "Amount too small for this lottery. Increase ticket count.", raw };
  if (lower.includes("lotterynotopen") || lower.includes("not open")) return { label: "Lottery is not open.", raw };
  if (lower.includes("lotteryexpired") || lower.includes("expired")) return { label: "Lottery is expired.", raw };
  if (lower.includes("ticketlimitreached") || lower.includes("limit")) return { label: "Ticket limit reached.", raw };

  // common RPC umbrella code (e.g. -32000)
  if (lower.includes("-32000") || lower.includes("internal error")) return { label: "RPC error. Please retry.", raw };

  return { label: "Purchase failed.", raw };
}

export function useLotteryInteraction(lotteryId: string | null, isOpen: boolean) {
  // NOTE: this hook still consumes useLotteryDetails
  const { data, loading, note } = useLotteryDetails(lotteryId, isOpen);

  const account = useActiveAccount();
  const me = account?.address ?? null;

  const { mutateAsync: sendAndConfirm, isPending } = useSendAndConfirmTransaction();
  const { fireConfetti } = useConfetti();

  const [nowMs, setNowMs] = useState(Date.now());
  const [tickets, setTickets] = useState("1");
  const [buyMsg, setBuyMsg] = useState<string | null>(null);

  // We keep these for UI display, but we fetch as little as possible.
  const [usdcBal, setUsdcBal] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [allowLoading, setAllowLoading] = useState(false);

  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  // ✅ range-policy UX (prevents BatchTooCheap silent reverts for first-time buyers)
  const [wouldCreateRange, setWouldCreateRange] = useState<boolean | null>(null);
  const [minTicketsForNewRange, setMinTicketsForNewRange] = useState<number>(1);

  // ✅ NEW: range-tier/capacity transparency (live, on-chain)
  const [rangeCount, setRangeCount] = useState<number | null>(null);
  const [rangeTier, setRangeTier] = useState<number | null>(null);
  const [nextTierAtRangeCount, setNextTierAtRangeCount] = useState<number | null>(null);
  const [rangesUntilNextTier, setRangesUntilNextTier] = useState<number | null>(null);
  const [minCostToCreateNewRange, setMinCostToCreateNewRange] = useState<bigint | null>(null);

  const [maxRanges, setMaxRanges] = useState<number | null>(null);
  const [rangeStep, setRangeStep] = useState<number | null>(null);
  const [baseCost, setBaseCost] = useState<bigint | null>(null);
  const [costStep, setCostStep] = useState<bigint | null>(null);

  // ✅ NEW: last successful purchase (for success screen)
  const [lastBuy, setLastBuy] = useState<{
    count: number;
    totalCostU: bigint;
    txHash?: string;
    timestampMs: number;
  } | null>(null);

  // ✅ revalidate ping (Home/Explore/ActivityBoard/etc)
  const delayedRevalRef = useRef<number | null>(null);

  const emitRevalidate = useCallback((withDelayedPing = true) => {
    try {
      if (typeof window === "undefined") return;
      window.dispatchEvent(new CustomEvent("ppopgi:revalidate"));
    } catch {}

    if (!withDelayedPing) return;

    // delayed ping to catch subgraph ingest lag
    try {
      if (typeof window === "undefined") return;
      if (delayedRevalRef.current != null) window.clearTimeout(delayedRevalRef.current);
      delayedRevalRef.current = window.setTimeout(() => {
        try {
          window.dispatchEvent(new CustomEvent("ppopgi:revalidate"));
        } catch {}
      }, 6000);
    } catch {}
  }, []);

  // ✅ optimistic store patch (instant list bump)
  const emitOptimisticBuy = useCallback(
    (deltaSold: number, patchId?: string) => {
      try {
        if (typeof window === "undefined" || !lotteryId) return;

        const deltaRevenue = (() => {
          try {
            const price = BigInt((data as any)?.ticketPrice || "0");
            const d = BigInt(Math.max(0, Math.floor(deltaSold)));
            return (price * d).toString();
          } catch {
            return undefined;
          }
        })();

        window.dispatchEvent(
          new CustomEvent("ppopgi:optimistic", {
            detail: {
              kind: "BUY",
              patchId,
              lotteryId,
              deltaSold,
              deltaRevenue,
              tsMs: Date.now(),
            },
          })
        );
      } catch {}
    },
    [lotteryId, data]
  );

  useEffect(() => {
    return () => {
      if (delayedRevalRef.current != null) {
        window.clearTimeout(delayedRevalRef.current);
        delayedRevalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isOpen]);

  const soldNow = Number((data as any)?.sold || "0");
  const maxTicketsN = Number((data as any)?.maxTickets || "0");
  const maxReached = maxTicketsN > 0 && soldNow >= maxTicketsN;

  const deadlineMs = Number((data as any)?.deadline || "0") * 1000;
  const deadlinePassed = deadlineMs > 0 && nowMs >= deadlineMs;

  const remainingTickets = maxTicketsN > 0 ? Math.max(0, maxTicketsN - soldNow) : null;

  let displayStatus = "Unknown";
  if (data) {
    if (data.status === "OPEN" && (deadlinePassed || maxReached)) displayStatus = "Finalizing";
    else if (data.status === "FUNDING_PENDING") displayStatus = "Getting ready";
    else if (data.status === "COMPLETED") displayStatus = "Settled";
    else if (data.status === "CANCELED") displayStatus = "Canceled";
    else if (data.status === "OPEN") displayStatus = "Open";
    else displayStatus = data.status.charAt(0) + data.status.slice(1).toLowerCase();
  }

  // ✅ Lottery contract (cast ABI to any to satisfy thirdweb Abi typing)
  const lotteryContract = useMemo(() => {
    if (!lotteryId) return null;
    return getContract({
      client: thirdwebClient,
      chain: ETHERLINK_CHAIN,
      address: lotteryId.toLowerCase(),
      abi: SingleWinnerLotteryABI as any,
    });
  }, [lotteryId]);

  /**
   * ✅ Use the lottery's indexed usdcToken when available, otherwise fall back to global config.
   */
  const paymentTokenAddr = useMemo(() => {
    const onchain = String((data as any)?.usdcToken || "").trim();
    if (onchain && !isZeroAddr(onchain)) return onchain;
    return ADDRESSES.USDC;
  }, [data]);

  // ✅ USDC contract (cast ABI to any to satisfy thirdweb Abi typing)
  const usdcContract = useMemo(() => {
    const addr = paymentTokenAddr;
    if (!addr || isZeroAddr(addr)) return null;
    return getContract({
      client: thirdwebClient,
      chain: ETHERLINK_CHAIN,
      address: addr,
      abi: USDC_ABI as any,
    });
  }, [paymentTokenAddr]);

  const isConnected = !!account?.address;

  const lotteryIsOpen =
    (data as any)?.status === "OPEN" &&
    !(data as any)?.paused &&
    !deadlinePassed &&
    !maxReached &&
    (maxTicketsN === 0 || (remainingTickets ?? 0) > 0);

  // ✅ Range-policy reads: if this buy would create a *new range*, enforce min tickets needed.
  useEffect(() => {
    if (!isOpen) return;
    if (!lotteryContract || !me) {
      setWouldCreateRange(null);
      setMinTicketsForNewRange(1);
      return;
    }

    let alive = true;

    (async () => {
      try {
        const would = await readContract({
          contract: lotteryContract as any,
          method: "function wouldCreateNewRange(address buyer) view returns (bool)",
          params: [me],
        }).catch(() => null as any);

        if (!alive) return;

        const w = Boolean(would);
        setWouldCreateRange(w);

        if (!w) {
          setMinTicketsForNewRange(1);
          return;
        }

        const minT = await readContract({
          contract: lotteryContract as any,
          method: "function minTicketsToOpenNewRangeNow() view returns (uint256)",
          params: [],
        }).catch(() => null as any);

        if (!alive) return;

        const n = Number(minT ?? 1);
        setMinTicketsForNewRange(Number.isFinite(n) && n > 0 ? Math.floor(n) : 1);
      } catch {
        if (!alive) return;
        setWouldCreateRange(null);
        setMinTicketsForNewRange(1);
      }
    })();

    return () => {
      alive = false;
    };
  }, [isOpen, lotteryContract, me]);

  // ✅ NEW: Range capacity + tier info (for transparency)
  useEffect(() => {
    if (!isOpen) return;

    if (!lotteryContract) {
      setRangeCount(null);
      setRangeTier(null);
      setNextTierAtRangeCount(null);
      setRangesUntilNextTier(null);
      setMinCostToCreateNewRange(null);
      setMaxRanges(null);
      setRangeStep(null);
      setBaseCost(null);
      setCostStep(null);
      return;
    }

    let alive = true;

    (async () => {
      try {
        const [tierInfo, policy] = await Promise.all([
          readContract({
            contract: lotteryContract as any,
            method:
              "function getRangeTierInfo() view returns (uint256 rangeCount,uint256 tier,uint256 minCostToCreateNewRange,uint256 nextTierAtRangeCount,uint256 rangesUntilNextTier)",
            params: [],
          }).catch(() => null as any),

          readContract({
            contract: lotteryContract as any,
            method: "function getRangePolicy() pure returns (uint256 maxRanges,uint256 rangeStep,uint256 baseCost,uint256 costStep)",
            params: [],
          }).catch(() => null as any),
        ]);

        if (!alive) return;

        const rc = Number(tierInfo?.[0] ?? 0);
        const t = Number(tierInfo?.[1] ?? 0);
        const minCost = BigInt(tierInfo?.[2] ?? 0n);
        const nextAt = Number(tierInfo?.[3] ?? 0);
        const until = Number(tierInfo?.[4] ?? 0);

        setRangeCount(Number.isFinite(rc) ? Math.floor(rc) : 0);
        setRangeTier(Number.isFinite(t) ? Math.floor(t) : 0);
        setMinCostToCreateNewRange(minCost);
        setNextTierAtRangeCount(Number.isFinite(nextAt) ? Math.floor(nextAt) : 0);
        setRangesUntilNextTier(Number.isFinite(until) ? Math.floor(until) : 0);

        const mr = Number(policy?.[0] ?? 0);
        const step = Number(policy?.[1] ?? 0);
        const bc = BigInt(policy?.[2] ?? 0n);
        const cs = BigInt(policy?.[3] ?? 0n);

        setMaxRanges(Number.isFinite(mr) ? Math.floor(mr) : 0);
        setRangeStep(Number.isFinite(step) ? Math.floor(step) : 0);
        setBaseCost(bc);
        setCostStep(cs);
      } catch {
        // keep previous values if a call fails
      }
    })();

    return () => {
      alive = false;
    };
  }, [isOpen, lotteryContract]);

  const rangeTierProgressPct = useMemo(() => {
    if (rangeCount == null || rangeTier == null || rangeStep == null || rangeStep <= 0) return null;

    const start = rangeTier * rangeStep;
    const end = start + rangeStep;
    const denom = Math.max(1, end - start);
    const p = ((rangeCount - start) / denom) * 100;

    if (!Number.isFinite(p)) return null;
    return Math.max(0, Math.min(100, p));
  }, [rangeCount, rangeTier, rangeStep]);

  const rangeCapacityPct = useMemo(() => {
    if (rangeCount == null || maxRanges == null || maxRanges <= 0) return null;
    const p = (rangeCount / maxRanges) * 100;
    if (!Number.isFinite(p)) return null;
    return Math.max(0, Math.min(100, p));
  }, [rangeCount, maxRanges]);

  const isNearTierUp = useMemo(() => {
    if (rangesUntilNextTier == null) return false;
    return rangesUntilNextTier <= 50;
  }, [rangesUntilNextTier]);

  // ✅ Respect minPurchaseAmount (contract rule) + range min (BatchTooCheap guard)
  const minPurchaseN = Number((data as any)?.minPurchaseAmount || "1");
  const contractMinPurchase = Math.max(1, Number.isFinite(minPurchaseN) ? Math.floor(minPurchaseN) : 1);

  const rangeMin = wouldCreateRange ? Math.max(1, minTicketsForNewRange) : 1;
  const uiMinBuy = Math.max(contractMinPurchase, rangeMin);

  // Cap by remaining tickets and contract MAX_BATCH_BUY (=1000)
  const uiMaxBuy = (() => {
    const maxByRemaining = maxTicketsN > 0 ? Math.max(0, remainingTickets || 0) : 1_000;
    return Math.min(1_000, maxByRemaining);
  })();

  const ticketCount = clampInt(toInt(tickets, uiMinBuy), uiMinBuy, Math.max(uiMinBuy, uiMaxBuy));

  const ticketPriceU = BigInt((data as any)?.ticketPrice || "0");
  const totalCostU = BigInt(ticketCount) * ticketPriceU;

  const hasEnoughAllowance = allowance !== null ? allowance >= totalCostU : false;

  // ✅ Safer UX: unknown balance => not enough (prevents confusing reverts)
  const hasEnoughBalance = usdcBal !== null ? usdcBal >= totalCostU : false;

  const allowInFlight = useRef(false);
  const lastAllowFetchAt = useRef(0);

  const refreshAllowance = useCallback(
    async (reason: "open" | "postTx" | "manual" | "preTx" = "manual") => {
      if (!isOpen) return;
      if (!account?.address || !usdcContract || !lotteryId) return;

      const acct = account.address;
      const token = paymentTokenAddr;
      const spender = lotteryId;
      const key = cacheKey(acct, token, spender);

      const now = Date.now();
      const minGap = reason === "postTx" ? 0 : 2500;
      if (now - lastAllowFetchAt.current < minGap) return;

      // ✅ Cache hit? (use cache only for "open"/"manual" to avoid stale overwrite after tx)
      const hit = allowBalCache.get(key);
      const canUseCache = reason === "open" || reason === "manual";
      if (canUseCache && hit && now - hit.ts < ALLOW_BAL_TTL_MS) {
        if (typeof hit.allowance === "bigint") setAllowance(hit.allowance);
        if (typeof hit.bal === "bigint") setUsdcBal(hit.bal);
        if (reason === "open") return;
      }

      if (allowInFlight.current) return;
      allowInFlight.current = true;
      lastAllowFetchAt.current = now;

      setAllowLoading(true);

      try {
        const allowanceP = readContract({
          contract: usdcContract as any,
          method: "function allowance(address owner, address spender) view returns (uint256)",
          params: [acct, spender],
        }).catch(() => 0n as any);

        const shouldReadBalance = reason === "manual" || reason === "preTx" || usdcBal == null;

        const balanceP = shouldReadBalance
          ? readContract({
              contract: usdcContract as any,
              method: "function balanceOf(address account) view returns (uint256)",
              params: [acct],
            }).catch(() => null as any)
          : Promise.resolve(null as any);

        const [a, bal] = await Promise.all([allowanceP, balanceP]);

        const aBi = BigInt((a as any) ?? 0n);
        setAllowance(aBi);

        let balBi: bigint | undefined = undefined;
        if (bal != null) {
          balBi = BigInt((bal as any) ?? 0n);
          setUsdcBal(balBi);
        }

        // Keep previous cached bal if we didn't read it this time
        const prev = allowBalCache.get(key);
        allowBalCache.set(key, { ts: Date.now(), allowance: aBi, bal: balBi ?? prev?.bal });
      } catch {
        setAllowance((prev) => prev ?? null);
        setUsdcBal((prev) => prev ?? null);
      } finally {
        setAllowLoading(false);
        allowInFlight.current = false;
      }
    },
    [isOpen, account?.address, usdcContract, lotteryId, paymentTokenAddr, usdcBal]
  );

  // ✅ When user returns from wallet, re-check allowance/balance automatically
  useEffect(() => {
    if (!isOpen) return;

    const onFocus = () => void refreshAllowance("manual");
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshAllowance("manual");
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [isOpen, refreshAllowance]);

  const approve = useCallback(async () => {
    setBuyMsg(null);

    if (!account?.address || !lotteryId) return;

    if (!usdcContract) {
      setBuyMsg("Payment token unavailable. Please retry.");
      return;
    }

    try {
      await refreshAllowance("preTx");

      const tx = prepareContractCall({
        contract: usdcContract as any,
        method: "function approve(address spender, uint256 amount) returns (bool)",
        params: [lotteryId, MaxUint256],
      });

      await sendAndConfirm(tx);

      setBuyMsg("✅ Wallet prepared. You can now buy tickets.");
      setAllowance(MaxUint256 as any);

      // Patch cache so UI won't regress to stale allowance
      try {
        const acct = account.address;
        const token = paymentTokenAddr;
        const spender = lotteryId;
        const key = cacheKey(acct, token, spender);
        const hit = allowBalCache.get(key);

        allowBalCache.set(key, {
          ts: Date.now(),
          allowance: MaxUint256 as any,
          bal: hit?.bal,
        });
      } catch {}

      void refreshAllowance("postTx");

      try {
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ppopgi:revalidate"));
      } catch {}
    } catch (e: any) {
      const { label } = parseTxError(e);
      setBuyMsg(label === "Purchase failed." ? "Prepare wallet failed." : label);
    }
  }, [account?.address, usdcContract, lotteryId, sendAndConfirm, refreshAllowance, paymentTokenAddr]);

  const buy = useCallback(async () => {
    setBuyMsg(null);
    if (!account?.address || !lotteryContract || !lotteryId) return;

    try {
      await refreshAllowance("preTx");

      // ✅ Guard: don't send a tx we already know will revert
      if (!lotteryIsOpen) {
        setBuyMsg("Lottery is not open.");
        return;
      }
      if (ticketCount < uiMinBuy) {
        setBuyMsg(`Minimum purchase is ${uiMinBuy} ticket${uiMinBuy === 1 ? "" : "s"}.`);
        return;
      }
      if (allowance === null || allowance < totalCostU) {
        setBuyMsg("Please approve USDC first.");
        return;
      }
      if (usdcBal === null || usdcBal < totalCostU) {
        setBuyMsg("Not enough USDC.");
        return;
      }

      const tx = prepareContractCall({
        contract: lotteryContract as any,
        method: "function buyTickets(uint256 count)",
        params: [BigInt(ticketCount)],
      });

      const receipt = await sendAndConfirm(tx);

      const txh = safeTxHash(receipt);
      const patchId = `buy:${lotteryId}:${txh || Date.now()}:${ticketCount}`;

      emitOptimisticBuy(ticketCount, patchId);

      const nowSec = Math.floor(Date.now() / 1000);
      emitActivity({
        type: "BUY",
        lotteryId: lotteryId.toLowerCase(),
        lotteryName: String((data as any)?.name ?? "Lottery"),
        subject: (me || "").toLowerCase(),
        value: String(ticketCount),
        timestamp: String(nowSec),
        txHash: txh || patchId,
        pendingLabel: "Indexing…",
      });

      // ✅ Success signal for modal success view
      setLastBuy({
        count: ticketCount,
        totalCostU,
        txHash: txh || undefined,
        timestampMs: Date.now(),
      });

      fireConfetti();
      setBuyMsg("🎉 Tickets purchased!");

      // Optimistic local + cache update
      try {
        const acct = account.address;
        const token = paymentTokenAddr;
        const spender = lotteryId;
        const key = cacheKey(acct, token, spender);
        const hit = allowBalCache.get(key);

        const newAllowance = allowance != null ? (allowance > totalCostU ? allowance - totalCostU : 0n) : undefined;
        const newBal = usdcBal != null ? (usdcBal > totalCostU ? usdcBal - totalCostU : 0n) : undefined;

        if (typeof newAllowance === "bigint") setAllowance(newAllowance);
        if (typeof newBal === "bigint") setUsdcBal(newBal);

        allowBalCache.set(key, {
          ts: Date.now(),
          allowance: typeof newAllowance === "bigint" ? newAllowance : hit?.allowance,
          bal: typeof newBal === "bigint" ? newBal : hit?.bal,
        });
      } catch {}

      void refreshAllowance("postTx");
      emitRevalidate(true);
    } catch (e: any) {
      const { label } = parseTxError(e);
      setBuyMsg(label);
    }
  }, [
    account?.address,
    lotteryContract,
    lotteryId,
    ticketCount,
    uiMinBuy,
    sendAndConfirm,
    fireConfetti,
    refreshAllowance,
    emitRevalidate,
    emitOptimisticBuy,
    data,
    me,
    allowance,
    usdcBal,
    totalCostU,
    paymentTokenAddr,
    lotteryIsOpen,
  ]);

  // ✅ avoid timer leak for copy message
  const copyTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (copyTimerRef.current != null) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  const handleShare = useCallback(async () => {
    if (!lotteryId) return;

    const url = `${window.location.origin}/?lottery=${lotteryId}`;

    try {
      await navigator.clipboard.writeText(url);
      setCopyMsg("Link copied!");
    } catch {
      setCopyMsg("Could not copy.");
    }

    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyMsg(null), 1500);
  }, [lotteryId]);

  // ✅ Reset only when modal OPENS (not when uiMinBuy changes)
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (!isOpen) return;

    if (!wasOpen && isOpen) {
      // opening fresh
      setTickets(String(uiMinBuy));
      setBuyMsg(null);
      setLastBuy(null);

      setUsdcBal(null);
      setAllowance(null);

      void refreshAllowance("open");
      return;
    }

    // If min changed upwards while open, nudge tickets up (don’t clear messages)
    setTickets((prev) => {
      const n = toInt(prev, uiMinBuy);
      if (n < uiMinBuy) return String(uiMinBuy);
      return prev;
    });
  }, [isOpen, uiMinBuy, refreshAllowance]);

  return {
    state: {
      data,
      loading,
      note,
      tickets,
      buyMsg,
      copyMsg,
      displayStatus,
      isConnected,
      isPending,
      allowLoading,
      usdcBal,
      allowance,
      paymentTokenAddr,

      // range-policy UX
      wouldCreateRange,
      minTicketsForNewRange,

      // ✅ range-tier/capacity transparency
      rangeCount,
      rangeTier,
      nextTierAtRangeCount,
      rangesUntilNextTier,
      minCostToCreateNewRange,
      maxRanges,
      rangeStep,
      baseCost,
      costStep,
      rangeTierProgressPct,
      rangeCapacityPct,
      isNearTierUp,

      // ✅ purchase success data
      lastBuy,
    },
    math: {
      minBuy: uiMinBuy,
      maxBuy: uiMaxBuy,
      remainingTickets,
      maxReached,
      ticketCount,
      totalCostU,
      fmtUsdc,
      short,
      nowMs,
      deadlineMs,
    },
    flags: {
      hasEnoughAllowance,
      hasEnoughBalance,
      lotteryIsOpen,
      canBuy: isConnected && lotteryIsOpen && hasEnoughAllowance && hasEnoughBalance && ticketCount >= uiMinBuy,
    },
    actions: {
      setTickets,
      approve,
      buy,
      handleShare,
      refreshAllowance: () => refreshAllowance("manual"),
      clearLastBuy: () => setLastBuy(null),
    },
  };
}