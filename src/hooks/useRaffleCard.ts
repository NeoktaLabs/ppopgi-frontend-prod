// src/hooks/useRaffleCard.ts
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { formatUnits } from "ethers";
import type { RaffleListItem } from "../indexer/subgraph";
import { useRevalidate } from "../hooks/useRevalidateTick";

// --- Helpers ---
const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const fmtUsdc = (raw: string) => {
  try {
    return formatUnits(BigInt(raw || "0"), 6);
  } catch {
    return "0";
  }
};

// Status Helper
function getDisplayStatus(status: string, deadline: string, nowMs: number) {
  const deadlineMs = Number(deadline) * 1000;
  const isExpired = deadlineMs > 0 && nowMs >= deadlineMs;

  if (status === "OPEN" && isExpired) return "Finalizing";
  if (status === "FUNDING_PENDING") return "Getting ready";
  if (status === "OPEN") return "Open";
  if (status === "DRAWING") return "Drawing";
  if (status === "COMPLETED") return "Settled";
  if (status === "CANCELED") return "Canceled";
  return "Unknown";
}

// Time Helper
function formatEndsIn(deadline: string, nowMs: number) {
  const deadlineMs = Number(deadline) * 1000;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return "—";

  const diff = deadlineMs - nowMs;
  if (diff <= 0) return "Ended";

  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");

  return d > 0 ? `${d}d ${pad(h)}h` : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

// Normalizes maxTickets legacy representations.
// - Some subgraphs store "0" (meaning unlimited), some store null-ish, etc.
// - UI wants: max=0 => "no cap" and progressMax should be 0.
function normalizeMaxTickets(maxTickets: any) {
  const n = toNum(maxTickets);
  return n > 0 ? n : 0;
}

export function useRaffleCard(raffle: RaffleListItem, nowMs: number) {
  // ✅ Revalidate tick: forces a rerender on relevant events.
  // This helps in cases where upstream data might be updated in-place.
  const rvTick = useRevalidate();

  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const clearMsgTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (clearMsgTimerRef.current != null) {
        window.clearTimeout(clearMsgTimerRef.current);
        clearMsgTimerRef.current = null;
      }
    };
  }, []);

  // 1) Status & Time
  const displayStatus = useMemo(
    () => getDisplayStatus(String(raffle.status || ""), String(raffle.deadline || "0"), nowMs),
    // include rvTick so the card recomputes on revalidate events even if raffle ref is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raffle.status, raffle.deadline, nowMs, rvTick]
  );

  const timeLeft = useMemo(
    () => formatEndsIn(String(raffle.deadline || "0"), nowMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raffle.deadline, nowMs, rvTick]
  );

  const isLive = displayStatus === "Open" || displayStatus === "Getting ready";

  // 2) Math (Progress)
  const sold = useMemo(() => toNum((raffle as any).sold), [raffle, rvTick]);

  const min = useMemo(() => toNum((raffle as any).minTickets), [raffle, rvTick]);

  const max = useMemo(
    () => normalizeMaxTickets((raffle as any).maxTickets ?? (raffle as any).maxTickets),
    [raffle, rvTick]
  );

  const hasMin = min > 0;
  const hasMax = max > 0;

  const minReached = !hasMin || sold >= min;

  const progressMin = hasMin ? clamp01(sold / min) : 0;
  const progressMax = hasMax ? clamp01(sold / max) : 0;

  // 3) Actions
  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const url = new URL(window.location.href);
    url.searchParams.set("raffle", raffle.id);
    const link = url.toString();

    try {
      // iOS Safari can be picky: navigator.share exists only in secure contexts and on some versions.
      const canShare =
        typeof navigator !== "undefined" &&
        "share" in navigator &&
        typeof (navigator as any).share === "function";

      if (canShare) {
        await (navigator as any).share({ url: link, title: raffle.name });
        setCopyMsg("Shared!");
      } else {
        // Clipboard API can also be restricted on iOS; fallback to copy attempt.
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(link);
          setCopyMsg("Link copied!");
        } else {
          // Last resort: prompt (works on older iOS)
          window.prompt("Copy this link:", link);
          setCopyMsg("Link ready!");
        }
      }
    } catch {
      setCopyMsg("Failed to share");
    }

    if (clearMsgTimerRef.current != null) window.clearTimeout(clearMsgTimerRef.current);
    clearMsgTimerRef.current = window.setTimeout(() => setCopyMsg(null), 1500);
  };

  const formattedPot = useMemo(() => fmtUsdc((raffle as any).winningPot), [raffle, rvTick]);
  const formattedPrice = useMemo(() => fmtUsdc((raffle as any).ticketPrice), [raffle, rvTick]);

  return {
    ui: {
      displayStatus,
      timeLeft,
      isLive,
      copyMsg,

      formattedPot,
      formattedPrice,

      sold,
      min,
      max,

      hasMin,
      hasMax,
      minReached,

      progressMinPct: `${Math.round(progressMin * 100)}%`,
      progressMaxPct: `${Math.round(progressMax * 100)}%`,
    },
    actions: { handleShare },
  };
}