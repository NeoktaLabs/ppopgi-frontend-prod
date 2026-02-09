// src/hooks/useRaffleInteraction.ts
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { formatUnits } from "ethers";
import { getContract, prepareContractCall, readContract } from "thirdweb";
import { useActiveAccount, useSendAndConfirmTransaction } from "thirdweb/react";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import { useRaffleDetails } from "./useRaffleDetails";
import { useConfetti } from "./useConfetti";

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

  // Remaining tickets (only meaningful if maxTickets is set)
  const remainingTickets = maxTicketsN > 0 ? Math.max(0, maxTicketsN - soldNow) : null;

  // Status label shown in UI
  let displayStatus = "Unknown";
  if (data) {
    if (data.status === "OPEN" && (deadlinePassed || maxReached)) displayStatus = "Finalizing";
    else if (data.status === "FUNDING_PENDING") displayStatus = "Getting ready";
    else if (data.status === "COMPLETED") displayStatus = "Settled";
    else if (data.status === "CANCELED") displayStatus = "Canceled";
    else if (data.status === "OPEN") displayStatus = "Open";
    else displayStatus = data.status.charAt(0) + data.status.slice(1).toLowerCase();
  }

  // UI min should always be 1 (you requested)
  const uiMinBuy = 1;

  // Cap max buy to remaining when maxTickets is set
  const uiMaxBuy = maxTicketsN > 0 ? Math.max(0, remainingTickets || 0) : 500; // UX cap when unlimited

  // Clamp ticketCount (if uiMaxBuy is 0, ticketCount will still clamp to 1, but buying will be disabled below)
  const ticketCount = clampInt(toInt(tickets, uiMinBuy), uiMinBuy, Math.max(uiMinBuy, uiMaxBuy));

  const ticketPriceU = BigInt(data?.ticketPrice || "0");
  const totalCostU = BigInt(ticketCount) * ticketPriceU;

  const raffleContract = useMemo(() => {
    if (!raffleId) return null;
    return getContract({ client: thirdwebClient, chain: ETHERLINK_CHAIN, address: raffleId });
  }, [raffleId]);

  const usdcContract = useMemo(() => {
    // NOTE: your subgraph type uses `usdc`, but your hook used `usdcToken`.
    // Keep as-is if your useRaffleDetails really returns `usdcToken`.
    if (!(data as any)?.usdcToken) return null;
    return getContract({ client: thirdwebClient, chain: ETHERLINK_CHAIN, address: (data as any).usdcToken });
  }, [data]);

  const isConnected = !!account?.address;

  // ✅ Close buying if: not OPEN, paused, deadline passed, max reached, or no remaining tickets
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

      let alive = true;
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

        if (!alive) return;
        setUsdcBal(BigInt(bal as any));
        setAllowance(BigInt(a as any));
      } catch {
        if (!alive) return;
        setUsdcBal(null);
        setAllowance(null);
      } finally {
        if (!alive) return;
        setAllowLoading(false);
        allowInFlight.current = false;
      }

      return () => {
        alive = false;
      };
    },
    [isOpen, account?.address, usdcContract, raffleId]
  );

  const approve = useCallback(async () => {
    setBuyMsg(null);
    if (!account?.address || !usdcContract || !raffleId) return;
    try {
      const tx = prepareContractCall({
        contract: usdcContract,
        method: "function approve(address,uint256) returns (bool)",
        params: [raffleId, totalCostU],
      });
      await sendAndConfirm(tx);
      setBuyMsg("✅ Wallet prepared.");
      refreshAllowance("postTx");
    } catch {
      setBuyMsg("Prepare wallet failed.");
    }
  }, [account?.address, usdcContract, raffleId, totalCostU, sendAndConfirm, refreshAllowance]);

  const buy = useCallback(async () => {
    setBuyMsg(null);
    if (!account?.address || !raffleContract) return;
    try {
      const tx = prepareContractCall({
        contract: raffleContract,
        method: "function buyTickets(uint256)",
        params: [BigInt(ticketCount)],
      });

      await sendAndConfirm(tx);

      fireConfetti();
      setBuyMsg("🎉 Tickets purchased!");
      refreshAllowance("postTx");
    } catch (e: any) {
      if (String(e).includes("insufficient")) setBuyMsg("Not enough coins.");
      else setBuyMsg("Purchase failed.");
    }
  }, [account?.address, raffleContract, ticketCount, sendAndConfirm, fireConfetti, refreshAllowance]);

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

    // Always default to 1 in the buy UI
    setTickets("1");
    setBuyMsg(null);

    refreshAllowance("open");
  }, [isOpen, raffleId, account?.address, refreshAllowance]);

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