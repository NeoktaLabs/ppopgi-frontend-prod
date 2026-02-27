// src/hooks/useCreateLotteryForm.ts
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { MaxUint256, parseUnits } from "ethers";
import { useActiveAccount, useSendAndConfirmTransaction } from "thirdweb/react";
import { getContract, prepareContractCall, readContract } from "thirdweb";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import { ADDRESSES } from "../config/contracts";

// ✅ IMPORTANT: use the FULL deployer ABI so custom errors can be decoded
import DEPLOYER_ABI from "../config/abis/SingleWinnerDeployer.json";

/* -------------------- utils -------------------- */

function sanitizeInt(raw: string) {
  return String(raw ?? "").replace(/[^\d]/g, "");
}

function toInt(raw: string, fallback = 0) {
  const n = Number(sanitizeInt(raw));
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

// ✅ allow decimal input for USDC fields (ticket price, winning pot)
function sanitizeUsdcDecimal(raw: string) {
  const s = String(raw ?? "").trim().replace(",", ".");
  const cleaned = s.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return parts[0] || "0";
  return `${parts[0] || "0"}.${parts.slice(1).join("")}`;
}

function parseUsdc(raw: string): bigint {
  const s = sanitizeUsdcDecimal(raw);
  if (!s || s === "." || s === "0." || s === ".0") return 0n;
  try {
    return parseUnits(s, 6);
  } catch {
    return 0n;
  }
}

function isAbortError(err: unknown) {
  const name = String((err as any)?.name ?? "");
  const msg = String((err as any)?.message ?? err ?? "");
  return name === "AbortError" || msg.toLowerCase().includes("abort");
}

function pickErrMessage(e: any): string {
  const msg =
    e?.shortMessage ||
    e?.message ||
    e?.cause?.shortMessage ||
    e?.cause?.message ||
    e?.details ||
    e?.reason ||
    "";
  return String(msg || "").trim();
}

function prettyCreateError(e: any): string {
  const raw = pickErrMessage(e);
  const msg = raw.toLowerCase();

  if (msg.includes("insufficient funds")) return "Not enough XTZ for gas on Etherlink.";
  if (msg.includes("user rejected") || msg.includes("rejected")) return "You rejected the transaction in your wallet.";
  if (msg.includes("wrong network") || msg.includes("chain")) return "Wallet is on the wrong network. Switch to Etherlink.";
  if (msg.includes("execution reverted") || msg.includes("revert")) return raw ? `Transaction reverted: ${raw}` : "Transaction reverted.";
  if (msg.includes("estimate gas") || msg.includes("gas")) return "Gas estimation failed (often due to a revert).";
  if (msg.includes("timeout")) return "Request timed out. Try again.";

  return raw ? `Creation failed: ${raw}` : "Creation failed.";
}

/* -------------------- minimal ERC20 ABI -------------------- */

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

/* -------------------- app events -------------------- */

type ActivityDetail = {
  type: "BUY" | "CREATE" | "WIN" | "CANCEL";
  lotteryId: string;
  lotteryName: string;
  subject: string;
  value: string;
  timestamp: string;
  txHash: string;
  pendingLabel?: string;
};

function emitActivity(detail: ActivityDetail) {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("ppopgi:activity", { detail }));
  } catch {}
}

function emitRevalidate(withDelayedPing = true) {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("ppopgi:revalidate"));
  } catch {}

  if (!withDelayedPing) return;

  try {
    window.setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent("ppopgi:revalidate"));
      } catch {}
    }, 7000);
  } catch {}
}

function emitOptimistic(detail: any) {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("ppopgi:optimistic", { detail }));
  } catch {}
}

/* -------------------- helpers -------------------- */

function isHexAddressTopic(topic: unknown): topic is string {
  if (typeof topic !== "string") return false;
  return /^0x[0-9a-fA-F]{64}$/.test(topic);
}

function topicToAddress(topic: string): string {
  return ("0x" + topic.slice(26)).toLowerCase();
}

async function tryRead<T>(contract: any, methodNames: string[], params: any[] = []) {
  for (const method of methodNames) {
    try {
      const value = await readContract({ contract, method, params });
      return { method, value: value as T };
    } catch {}
  }
  return null;
}

function clampFeePct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(20, n));
}

/* -------------------- hook -------------------- */

type AllowanceSnapshot = { bal: bigint; allowance: bigint; ts: number };
const SNAPSHOT_TTL_MS = 12_000;

// bounds
const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = (1n << 32n) - 1n;

export function useCreateLotteryForm(isOpen: boolean, onCreated?: (addr?: string) => void) {
  const account = useActiveAccount();
  const me = account?.address ?? null;
  const { mutateAsync: sendAndConfirm, isPending } = useSendAndConfirmTransaction();

  /* ---------- form state ---------- */

  const [name, setName] = useState("");
  const [ticketPrice, setTicketPrice] = useState("5");
  const [winningPot, setWinningPot] = useState("100");
  const [durationValue, setDurationValue] = useState("24");
  const [durationUnit, setDurationUnit] = useState<"minutes" | "hours" | "days">("hours");

  const [minTickets, setMinTickets] = useState("1");
  const [maxTickets, setMaxTickets] = useState("");
  const [minPurchaseAmount, setMinPurchaseAmount] = useState("1");

  /* ---------- web3 state ---------- */

  const [msg, setMsg] = useState<string | null>(null);
  const [usdcBal, setUsdcBal] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [allowLoading, setAllowLoading] = useState(false);

  // ✅ on-chain fee config
  const [protocolFeePercent, setProtocolFeePercent] = useState<number | null>(null);
  const [protocolFeeRecipient, setProtocolFeeRecipient] = useState<string | null>(null);

  // ✅ separate request IDs so fee reads never cancel allowance reads
  const allowReqIdRef = useRef(0);
  const feeReqIdRef = useRef(0);

  const lastSnapRef = useRef<AllowanceSnapshot | null>(null);

  const deployerContract = useMemo(
    () =>
      getContract({
        client: thirdwebClient,
        chain: ETHERLINK_CHAIN,
        address: ADDRESSES.SingleWinnerDeployer,
        abi: DEPLOYER_ABI as any,
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

  /* ---------- calculations ---------- */

  const unitSeconds = durationUnit === "minutes" ? 60 : durationUnit === "hours" ? 3600 : 86400;
  const durationSecondsN = toInt(durationValue, 0) * unitSeconds;

  const ticketPriceU = useMemo(() => parseUsdc(ticketPrice), [ticketPrice]);
  const winningPotU = useMemo(() => parseUsdc(winningPot), [winningPot]);

  const minT = BigInt(Math.max(1, toInt(minTickets, 1)));
  const maxT = BigInt(Math.max(0, toInt(maxTickets, 0)));
  const minPurchaseU32N = Math.max(1, toInt(minPurchaseAmount, 1));

  const durOk = durationSecondsN >= 60;
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

  /* ---------- allowance/balance refresh ---------- */

  const refreshAllowance = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!isOpen || !me) return;

      const snap = lastSnapRef.current;
      if (!opts.force && snap && Date.now() - snap.ts < SNAPSHOT_TTL_MS) {
        setUsdcBal(snap.bal);
        setAllowance(snap.allowance);
        return;
      }

      const reqId = ++allowReqIdRef.current;
      setAllowLoading(true);

      try {
        const [bal, a] = await Promise.all([
          readContract({ contract: usdcContract, method: "balanceOf", params: [me] }),
          readContract({ contract: usdcContract, method: "allowance", params: [me, ADDRESSES.SingleWinnerDeployer] }),
        ]);

        if (reqId !== allowReqIdRef.current) return;

        const balB = BigInt(bal ?? 0n);
        const allowB = BigInt(a ?? 0n);

        lastSnapRef.current = { bal: balB, allowance: allowB, ts: Date.now() };
        setUsdcBal(balB);
        setAllowance(allowB);
      } catch {
        if (reqId !== allowReqIdRef.current) return;
        setMsg((prev) => prev ?? "Could not refresh USDC balance/allowance. Try again.");
      } finally {
        if (reqId === allowReqIdRef.current) setAllowLoading(false);
      }
    },
    [isOpen, me, usdcContract]
  );

  /* ---------- fee refresh (on-chain) ---------- */

  const refreshFeeConfig = useCallback(async () => {
    if (!isOpen) return;

    const reqId = ++feeReqIdRef.current;

    try {
      // Try common method names. One of these should exist in your deployer ABI.
      const feeRes = await tryRead<any>(deployerContract, [
        "protocolFeePercent", // your UI expects percent
        "protocolFee",        // sometimes named like this
        "feePercent",         // alt
        "protocolFeeBps",     // bps variants
        "feeBps",
      ]);

      const recRes = await tryRead<any>(deployerContract, [
        "feeRecipient",
        "protocolFeeRecipient",
      ]);

      if (reqId !== feeReqIdRef.current) return;

      // If fee is in bps, divide by 100
      let pct: number | null = null;
      if (feeRes?.value != null) {
        const raw = BigInt(feeRes.value?.toString?.() ?? String(feeRes.value));
        const isBps = feeRes.method.toLowerCase().includes("bps");
        const asNum = isBps ? Number(raw) / 100 : Number(raw);
        pct = clampFeePct(asNum);
      }

      const recipient = recRes?.value != null ? String(recRes.value).toLowerCase() : null;

      setProtocolFeePercent(pct);
      setProtocolFeeRecipient(recipient);
    } catch {
      if (reqId !== feeReqIdRef.current) return;
      setProtocolFeePercent(null);
      setProtocolFeeRecipient(null);
    }
  }, [isOpen, deployerContract]);

  /* ---------- approve ---------- */

  const approve = async () => {
    setMsg(null);
    if (!me) return;

    try {
      setMsg("Confirm approval in wallet...");

      const tx = prepareContractCall({
        contract: usdcContract,
        method: "approve",
        params: [ADDRESSES.SingleWinnerDeployer, MaxUint256],
      });

      await sendAndConfirm(tx);
      setMsg("Approval successful!");
      await refreshAllowance({ force: true });
      emitRevalidate(false);
    } catch (e: any) {
      if (isAbortError(e)) return;
      console.error("APPROVE_FAILED full error:", e);
      setMsg(pickErrMessage(e) ? `Approval failed: ${pickErrMessage(e)}` : "Approval failed.");
    }
  };

  /* ---------- create ---------- */

  const create = async () => {
    setMsg(null);
    if (!canSubmit) return;

    const minTicketsU64 = minT;
    const maxTicketsU64 = maxT;
    const durationU64 = BigInt(Math.max(0, Math.floor(durationSecondsN)));
    const minPurchaseU32 = BigInt(Math.max(1, Math.floor(minPurchaseU32N)));

    if (minTicketsU64 > U64_MAX || maxTicketsU64 > U64_MAX || durationU64 > U64_MAX) {
      setMsg("Creation failed: one of the numeric inputs is too large.");
      return;
    }
    if (minPurchaseU32 > U32_MAX) {
      setMsg("Creation failed: Min Purchase is too large.");
      return;
    }

    try {
      setMsg("Confirm creation in wallet...");

      const tx = prepareContractCall({
        contract: deployerContract,
        method: "createSingleWinnerLottery",
        params: [name.trim(), ticketPriceU, winningPotU, minTicketsU64, maxTicketsU64, durationU64, minPurchaseU32],
      });

      const receipt = await sendAndConfirm(tx);

      let newAddr = "";
      const logs: any[] = (receipt as any)?.logs ?? [];
      for (const log of logs) {
        const addr = String(log?.address ?? "").toLowerCase();
        if (addr !== ADDRESSES.SingleWinnerDeployer.toLowerCase()) continue;

        const t1 = log?.topics?.[1];
        if (isHexAddressTopic(t1)) {
          newAddr = topicToAddress(t1);
          break;
        }
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const txHash = String((receipt as any)?.transactionHash ?? `create:${nowSec}:${me}`);

      emitOptimistic({
        kind: "CREATE",
        patchId: txHash,
        tsMs: Date.now(),
        lottery: {
          id: (newAddr || "0x").toLowerCase(),
          name: name.trim(),
          creator: me?.toLowerCase(),
          status: "OPEN",
          typeId: "1",
          registeredAt: String(nowSec),
          ticketPrice: ticketPriceU.toString(),
          winningPot: winningPotU.toString(),
          minTickets: String(minTicketsU64),
          maxTickets: String(maxTicketsU64),
          minPurchaseAmount: String(minPurchaseU32),
          deadline: String(nowSec + Number(durationU64)),
          usdcToken: ADDRESSES.USDC.toLowerCase(),
        },
      });

      emitActivity({
        type: "CREATE",
        lotteryId: (newAddr || "0x").toLowerCase(),
        lotteryName: name.trim(),
        subject: me?.toLowerCase() ?? "",
        value: winningPotU.toString(),
        timestamp: String(nowSec),
        txHash,
        pendingLabel: "Indexing…",
      });

      setMsg("🎉 Success!");
      await refreshAllowance({ force: true });
      emitRevalidate(true);
      onCreated?.(newAddr || undefined);
    } catch (e: any) {
      if (isAbortError(e)) return;
      console.error("CREATE_FAILED full error:", e);
      setMsg(prettyCreateError(e));
    }
  };

  /* ---------- lifecycle (NO POLLING) ---------- */

  useEffect(() => {
    if (!isOpen) return;

    refreshAllowance({ force: true });
    void refreshFeeConfig();

    return () => {
      allowReqIdRef.current++;
      feeReqIdRef.current++;
    };
  }, [isOpen, me, refreshAllowance, refreshFeeConfig]);

  useEffect(() => {
    if (!isOpen) return;

    const onVis = () => {
      if (document.visibilityState === "visible") {
        refreshAllowance({ force: false });
        void refreshFeeConfig();
      }
    };

    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isOpen, refreshAllowance, refreshFeeConfig]);

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
      protocolFeePercent,     // ✅ for UI
      protocolFeeRecipient,   // ✅ for UI
    },
    status: { msg, isPending, allowLoading, usdcBal, approve, create, refresh: refreshAllowance },
    helpers: { sanitizeInt },
  };
}