// src/hooks/useCashierData.ts
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { formatUnits } from "ethers";
import { useActiveAccount } from "thirdweb/react";
import { getContract, readContract } from "thirdweb";
import { getWalletBalance } from "thirdweb/wallets";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import { ADDRESSES } from "../config/contracts";

// Minimal ERC20 ABI (only what we use)
const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Helper: Format BigInt to string with max 4 decimals
function fmtMax4(raw: bigint, decimals: number) {
  try {
    const full = formatUnits(raw, decimals);
    const [int, frac] = full.split(".");
    if (!frac) return int;
    const limitedFrac = frac.slice(0, 4);
    return limitedFrac ? `${int}.${limitedFrac}` : int;
  } catch {
    return "0";
  }
}

function toBigIntSafe(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
    return 0n;
  } catch {
    return 0n;
  }
}

export function useCashierData(isOpen: boolean) {
  const activeAccount = useActiveAccount();
  const me = activeAccount?.address ?? null;

  const [xtz, setXtz] = useState<bigint | null>(null);
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Guards against stale async responses (open/close, account switching)
  const reqIdRef = useRef(0);

  // ✅ Single source of truth for USDC address
  const usdcContract = useMemo(() => {
    return getContract({
      client: thirdwebClient,
      chain: ETHERLINK_CHAIN,
      address: ADDRESSES.USDC.toLowerCase(),
      abi: ERC20_ABI,
    });
  }, []);

  const refresh = useCallback(async () => {
    const reqId = ++reqIdRef.current;

    setNote(null);

    // If modal is closed, don't even start work
    if (!isOpen) return;

    if (!me) {
      setXtz(null);
      setUsdc(null);
      setLoading(false);
      setNote("Sign in to see your balances.");
      return;
    }

    setLoading(true);
    try {
      const [native, token] = await Promise.all([
        getWalletBalance({
          client: thirdwebClient,
          chain: ETHERLINK_CHAIN,
          address: me,
        }),
        readContract({
          contract: usdcContract,
          method: "balanceOf",
          params: [me],
        }),
      ]);

      // Ignore stale responses or closed modal
      if (reqId !== reqIdRef.current || !isOpen) return;

      setXtz(toBigIntSafe((native as { value?: bigint }).value));
      setUsdc(toBigIntSafe(token));
    } catch {
      if (reqId !== reqIdRef.current || !isOpen) return;
      setXtz(null);
      setUsdc(null);
      setNote("Could not load balances. Try refreshing.");
    } finally {
      if (reqId === reqIdRef.current && isOpen) setLoading(false);
    }
  }, [me, usdcContract, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    refresh();

    // Invalidate any in-flight request when modal closes/unmounts
    return () => {
      reqIdRef.current++;
    };
  }, [isOpen, refresh]);

  return {
    state: { me, xtz, usdc, loading, note },
    actions: { refresh },
    display: {
      xtz: xtz === null ? "—" : fmtMax4(xtz, 18),
      usdc: usdc === null ? "—" : fmtMax4(usdc, 6),
      shortAddr: me ? `${me.slice(0, 6)}…${me.slice(-4)}` : "Not signed in",
    },
  };
}