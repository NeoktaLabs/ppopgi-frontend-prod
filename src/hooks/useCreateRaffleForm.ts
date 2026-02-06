// src/hooks/useCreateRaffleForm.ts
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { parseUnits } from "ethers";
import { useActiveAccount, useSendAndConfirmTransaction } from "thirdweb/react";
import { getContract, prepareContractCall, readContract } from "thirdweb";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import { ADDRESSES } from "../config/contracts";

function sanitizeInt(raw: string) {
  return raw.replace(/[^\d]/g, "");
}
function toInt(raw: string, fallback = 0) {
  const n = Number(sanitizeInt(raw));
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

// Minimal ERC20 ABI
const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function useCreateRaffleForm(isOpen: boolean, onCreated?: (addr?: string) => void) {
  const account = useActiveAccount();
  const me = account?.address ?? null;
  const { mutateAsync: sendAndConfirm, isPending } = useSendAndConfirmTransaction();

  // --- Form State ---
  const [name, setName] = useState("");
  const [ticketPrice, setTicketPrice] = useState("5");
  const [winningPot, setWinningPot] = useState("100");
  const [durationValue, setDurationValue] = useState("24");
  const [durationUnit, setDurationUnit] = useState<"minutes" | "hours" | "days">("hours");

  // Limits
  const [minTickets, setMinTickets] = useState("1");
  const [maxTickets, setMaxTickets] = useState("");
  const [minPurchaseAmount, setMinPurchaseAmount] = useState("1");

  // --- Web3 State ---
  const [msg, setMsg] = useState<string | null>(null);
  const [usdcBal, setUsdcBal] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [allowLoading, setAllowLoading] = useState(false);

  // stale-response guard
  const reqIdRef = useRef(0);

  // --- Contracts ---
  const factoryContract = useMemo(
    () =>
      getContract({
        client: thirdwebClient,
        chain: ETHERLINK_CHAIN,
        address: ADDRESSES.SingleWinnerDeployer,
      }),
    []
  );

  const usdcContract = useMemo(
    () =>
      getContract({
        client: thirdwebClient,
        chain: ETHERLINK_CHAIN,
        address: ADDRESSES.USDC,
        abi: ERC20_ABI,
      }),
    []
  );

  // --- Calculations ---
  const unitSeconds = durationUnit === "minutes" ? 60 : durationUnit === "hours" ? 3600 : 86400;
  const durationSecondsN = toInt(durationValue, 0) * unitSeconds;

  const ticketPriceInt = toInt(ticketPrice, 0);
  const winningPotInt = toInt(winningPot, 0);

  const ticketPriceU = useMemo(() => {
    try {
      return parseUnits(String(ticketPriceInt), 6);
    } catch {
      return 0n;
    }
  }, [ticketPriceInt]);

  const winningPotU = useMemo(() => {
    try {
      return parseUnits(String(winningPotInt), 6);
    } catch {
      return 0n;
    }
  }, [winningPotInt]);

  const minT = BigInt(Math.max(1, toInt(minTickets, 1)));
  const maxT = BigInt(Math.max(0, toInt(maxTickets, 0)));
  const minPurchaseU32 = Math.max(1, toInt(minPurchaseAmount, 1));

  // --- Validation ---
  const durOk = durationSecondsN >= 60; // Min 1 min
  const hasEnoughAllowance = allowance !== null && allowance >= winningPotU;
  const hasEnoughBalance = usdcBal !== null && usdcBal >= winningPotU;

  const canSubmit =
    !!me &&
    !isPending &&
    name.trim().length > 0 &&
    durOk &&
    winningPotU > 0n &&
    ticketPriceU > 0n &&
    hasEnoughAllowance &&
    hasEnoughBalance;

  // --- Actions ---
  const refreshAllowance = useCallback(async () => {
    if (!isOpen || !me) return;

    const reqId = ++reqIdRef.current;
    setAllowLoading(true);

    try {
      const [bal, a] = await Promise.all([
        readContract({ contract: usdcContract, method: "balanceOf", params: [me] }),
        readContract({
          contract: usdcContract,
          method: "allowance",
          params: [me, ADDRESSES.SingleWinnerDeployer],
        }),
      ]);

      if (reqId !== reqIdRef.current) return;

      setUsdcBal(BigInt(bal ?? 0n));
      setAllowance(BigInt(a ?? 0n));
    } catch (e) {
      // don't spam errors, just log once per refresh attempt
      console.error("USDC refresh failed", e);
    } finally {
      if (reqId === reqIdRef.current) setAllowLoading(false);
    }
  }, [isOpen, me, usdcContract]);

  // 1) APPROVE
  const approve = async () => {
    setMsg(null);
    if (!me) return;

    try {
      setMsg("Please confirm approval in wallet...");

      const tx = prepareContractCall({
        contract: usdcContract,
        method: "approve",
        params: [ADDRESSES.SingleWinnerDeployer, winningPotU],
      });

      await sendAndConfirm(tx);
      setMsg("Approval successful!");
      await refreshAllowance();
    } catch (e) {
      console.error("Approve failed", e);
      setMsg("Approval failed.");
    }
  };

  // 2) CREATE
  const create = async () => {
    setMsg(null);
    if (!canSubmit) return;

    try {
      setMsg("Please confirm creation in wallet...");

      const tx = prepareContractCall({
        contract: factoryContract,
        method:
          "function createSingleWinnerLottery(string,uint256,uint256,uint64,uint64,uint64,uint32) returns (address)",
        params: [name.trim(), ticketPriceU, winningPotU, minT, maxT, BigInt(durationSecondsN), minPurchaseU32],
      });

      const receipt = await sendAndConfirm(tx);

      // Try to derive new address from logs (best-effort)
      let newAddr = "";
      const logs: any[] = (receipt as any)?.logs ?? [];
      for (const log of logs) {
        if (String(log?.address || "").toLowerCase() !== ADDRESSES.SingleWinnerDeployer.toLowerCase()) continue;
        const topics: string[] = log?.topics ?? [];
        if (topics[1]) {
          newAddr = "0x" + topics[1].slice(26);
          break;
        }
      }

      setMsg("🎉 Success!");
      // refresh balances/allowance after creation (pot got transferred/locked)
      await refreshAllowance();
      onCreated?.(newAddr || undefined);
    } catch (e) {
      console.error("Create failed", e);
      setMsg("Creation failed.");
    }
  };

  /**
   * Reduced polling strategy:
   * - refresh immediately on open
   * - refresh on focus / visibility changes (feels instant to user)
   * - light polling every 15s only while open AND only if not ready yet
   * - stop polling once allowance is sufficient
   */
  useEffect(() => {
    if (!isOpen) return;

    setMsg(null);
    refreshAllowance();

    const onFocus = () => refreshAllowance();
    const onVis = () => {
      if (document.visibilityState === "visible") refreshAllowance();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    // Poll less frequently, and only if still not ready
    const intervalMs = 15000;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // only poll if user still needs allowance/balance to proceed
      const needs = !hasEnoughAllowance || !hasEnoughBalance;
      if (needs) refreshAllowance();
    }, intervalMs);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(t);
      reqIdRef.current++; // invalidate in-flight
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, me, refreshAllowance, hasEnoughAllowance, hasEnoughBalance]);

  return {
    form: {
      name,
      setName,
      ticketPrice,
      setTicketPrice,
      winningPot,
      setWinningPot,
      durationValue,
      setDurationValue,
      durationUnit,
      setDurationUnit,
      minTickets,
      setMinTickets,
      maxTickets,
      setMaxTickets,
      minPurchaseAmount,
      setMinPurchaseAmount,
    },
    validation: {
      durOk,
      hasEnoughBalance,
      hasEnoughAllowance,
      canSubmit,
      durationSecondsN,
    },
    derived: {
      ticketPriceU,
      winningPotU,
      minT,
      maxT,
      me,
      configData: { feeRecipient: ADDRESSES.SingleWinnerDeployer, protocolFeePercent: 5 },
    },
    status: {
      msg,
      isPending,
      allowLoading,
      usdcBal,
      // UI uses this to disable "Approve" button (true when allowance is enough)
      isReady: hasEnoughAllowance,
      approve,
      create,
      refresh: refreshAllowance, // handy for a manual refresh button
    },
    helpers: { sanitizeInt },
  };
}