// src/hooks/useRaffleInteraction.ts
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { formatUnits } from "ethers";
import { getContract, prepareContractCall, readContract } from "thirdweb";
import { useActiveAccount, useSendAndConfirmTransaction } from "thirdweb/react";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import { useRaffleDetails } from "./useRaffleDetails";
import { useConfetti } from "./useConfetti";
import { ADDRESSES } from "../config/contracts";

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
    receipt?.transactionHash ||
      receipt?.hash ||
      receipt?.receipt?.transactionHash ||
      receipt?.receipt?.hash ||
      ""
  ).toLowerCase();
}

export function useRaffleInteraction(raffleId: string | null, isOpen: boolean) {
  const { data, loading, note } = useRaffleDetails(raffleId, isOpen);
  const account = useActiveAccount();
  const { mutateAsync: sendAndConfirm, isPending } = useSendAndConfirmTransaction();
  const { fireConfetti } = useConfetti();

  const [nowMs, setNowMs] = useState(Date.now());
  const [tickets, setTickets] = useState("1");
  const [buyMsg, setBuyMsg] = useState<string | null>(null);
  const [usdcBal, setUsdcBal] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [allowLoading, setAllowLoading] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

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

  // ✅ optimistic store patch (instant UI)
  const emitOptimisticBuy = useCallback(
    (deltaSold: number, patchId?: string) => {
      try {
        if (typeof window === "undefined" || !raffleId) return;
        window.dispatchEvent(
          new CustomEvent("ppopgi:optimistic", {
            detail: {
              kind: "BUY",
              patchId,
              raffleId,
              deltaSold,
              tsMs: Date.now(),
            },
          })
        );
      } catch {}
    },
    [raffleId]
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

  const soldNow = Number(data?.sold || "0");
  const maxTicketsN = Number(data?.maxTickets || "0");
  const maxReached = maxTicketsN > 0 && soldNow >= maxTicketsN;

  const deadlineMs = Number(data?.deadline || "0") * 1000;
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

  const uiMinBuy = 1;
  const uiMaxBuy = maxTicketsN > 0 ? Math.max(0, remainingTickets || 0) : 500;

  const ticketCount = clampInt(toInt(tickets, uiMinBuy), uiMinBuy, Math.max(uiMinBuy, uiMaxBuy));

  const ticketPriceU = BigInt(data?.ticketPrice || "0");
  const totalCostU = BigInt(ticketCount) * ticketPriceU;

  const raffleContract = useMemo(() => {
    if (!raffleId) return null;
    return getContract({ client: thirdwebClient, chain: ETHERLINK_CHAIN, address: raffleId });
  }, [raffleId]);

  /**
   * ✅ IMPORTANT:
   * Use the raffle's on-chain usdcToken() when available, otherwise fall back to global config.
   * This fixes "balance shows 0 / not enough" when a raffle uses a different token address.
   */
  const paymentTokenAddr = useMemo(() => {
    const onchain = String(data?.usdcToken || "").trim();
    if (onchain && !isZeroAddr(onchain)) return onchain;
    return ADDRESSES.USDC;
  }, [data?.usdcToken]);

  const usdcContract = useMemo(() => {
    const addr = paymentTokenAddr;
    if (!addr || isZeroAddr(addr)) return null;
    return getContract({ client: thirdwebClient, chain: ETHERLINK_CHAIN, address: addr });
  }, [paymentTokenAddr]);

  const isConnected = !!account?.address;

  const raffleIsOpen =
    data?.status === "OPEN" &&
    !data.paused &&
    !deadlinePassed &&
    !maxReached &&
    (maxTicketsN === 0 || (remainingTickets ?? 0) > 0);

  const hasEnoughAllowance = allowance !== null ? allowance >= totalCostU : false;
  const hasEnoughBalance = usdcBal !== null ? usdcBal >= totalCostU : true;

  const allowInFlight = useRef(false);
  const lastAllowFetchAt = useRef(0);

  const refreshAllowance = useCallback(
    async (reason: "open" | "postTx" | "manual" = "manual") => {
      if (!isOpen) return;
      if (!account?.address || !usdcContract || !raffleId) return;

      const now = Date.now();
      const minGap = reason === "postTx" ? 0 : 2500;
      if (now - lastAllowFetchAt.current < minGap) return;

      if (allowInFlight.current) return;
      allowInFlight.current = true;
      lastAllowFetchAt.current = now;

      setAllowLoading(true);

      try {
        const [bal, a] = await Promise.all([
          readContract({
            contract: usdcContract,
            method: "function balanceOf(address) view returns (uint256)",
            params: [account.address],
          }),
          readContract({
            contract: usdcContract,
            method: "function allowance(address,address) view returns (uint256)",
            params: [account.address, raffleId],
          }),
        ]);

        setUsdcBal(BigInt(bal as any));
        setAllowance(BigInt(a as any));
      } catch {
        setUsdcBal(null);
        setAllowance(null);
      } finally {
        setAllowLoading(false);
        allowInFlight.current = false;
      }
    },
    [isOpen, account?.address, usdcContract, raffleId]
  );

  const approve = useCallback(async () => {
    setBuyMsg(null);

    if (!account?.address || !raffleId) return;

    if (!usdcContract) {
      setBuyMsg("Payment token unavailable. Please retry.");
      return;
    }

    try {
      const tx = prepareContractCall({
        contract: usdcContract,
        method: "function approve(address,uint256) returns (bool)",
        params: [raffleId, totalCostU],
      });
      await sendAndConfirm(tx);

      setBuyMsg("✅ Wallet prepared.");
      refreshAllowance("postTx");

      emitRevalidate(false);
    } catch {
      setBuyMsg("Prepare wallet failed.");
    }
  }, [account?.address, usdcContract, raffleId, totalCostU, sendAndConfirm, refreshAllowance, emitRevalidate]);

  const buy = useCallback(async () => {
    setBuyMsg(null);
    if (!account?.address || !raffleContract) return;

    try {
      const tx = prepareContractCall({
        contract: raffleContract,
        method: "function buyTickets(uint256)",
        params: [BigInt(ticketCount)],
      });

      const receipt = await sendAndConfirm(tx);

      const txh = safeTxHash(receipt);
      const patchId = `buy:${raffleId}:${txh || Date.now()}:${ticketCount}`;
      emitOptimisticBuy(ticketCount, patchId);

      fireConfetti();
      setBuyMsg("🎉 Tickets purchased!");
      refreshAllowance("postTx");

      emitRevalidate(true);
    } catch (e: any) {
      if (String(e).toLowerCase().includes("insufficient")) setBuyMsg("Not enough coins.");
      else setBuyMsg("Purchase failed.");
    }
  }, [
    account?.address,
    raffleContract,
    ticketCount,
    sendAndConfirm,
    fireConfetti,
    refreshAllowance,
    emitRevalidate,
    emitOptimisticBuy,
    raffleId,
  ]);

  const handleShare = useCallback(async () => {
    if (!raffleId) return;
    const url = `${window.location.origin}/?raffle=${raffleId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyMsg("Link copied!");
    } catch {
      setCopyMsg("Could not copy.");
    }
    setTimeout(() => setCopyMsg(null), 1500);
  }, [raffleId]);

  useEffect(() => {
    if (!isOpen) return;

    setTickets("1");
    setBuyMsg(null);

    // reset displayed balances when switching raffles / token
    setUsdcBal(null);
    setAllowance(null);

    refreshAllowance("open");
  }, [isOpen, raffleId, account?.address, paymentTokenAddr, refreshAllowance]);

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
      // optional: helpful for debugging in the modal
      paymentTokenAddr,
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
      raffleIsOpen,
      canBuy: isConnected && raffleIsOpen && hasEnoughAllowance && hasEnoughBalance,
    },
    actions: {
      setTickets,
      approve,
      buy,
      handleShare,
      refreshAllowance: () => refreshAllowance("manual"),
    },
  };
}