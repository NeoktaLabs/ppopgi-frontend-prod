// src/hooks/useHomeLotteries.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LotteryListItem } from "../indexer/subgraph";
import { fetchLotteriesOnChainFallback } from "../onchain/fallbackLotteries";

import { useLotteryStore, refresh as refreshLotteryStore } from "./useLotteryStore";
import { useRevalidate } from "./useRevalidateTick";

type Mode = "indexer" | "live";

function numOr0(v?: string | null) {
  const n = Number(v || "0");
  return Number.isFinite(n) ? n : 0;
}

// Sort helper: treat 0 / missing deadlines as "far future" so they don't appear as "ending soon"
function deadlineSortKey(deadline?: string | null) {
  const d = numOr0(deadline);
  return d > 0 ? d : Number.MAX_SAFE_INTEGER;
}

function isRateLimitNote(note: string) {
  const s = (note || "").toLowerCase();
  return s.includes("too many requests") || s.includes("rate") || s.includes("429");
}

function shouldFallback(note: string | null) {
  if (!note) return false;
  const s = note.toLowerCase();

  // Only fallback for genuine “indexer down/unreachable” cases.
  // For rate-limits, better to wait/backoff than hammer on-chain + indexer.
  if (isRateLimitNote(note)) return false;

  return (
    s.includes("failed") ||
    s.includes("unavailable") ||
    s.includes("could not") ||
    s.includes("error") ||
    s.includes("timeout")
  );
}

// --------------------- hook ---------------------

export function useHomeLotteries() {
  // ✅ Shared store snapshot (indexer)
  const store = useLotteryStore("home", 20_000);

  // ✅ Revalidate tick (event-based refresh)
  const rvTick = useRevalidate();

  // Local override (live fallback)
  const [mode, setMode] = useState<Mode>("indexer");
  const [note, setNote] = useState<string | null>(null);
  const [liveItems, setLiveItems] = useState<LotteryListItem[] | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  // Prevent hammering live fallback
  const lastLiveAtRef = useRef<number>(0);
  const LIVE_CACHE_MS = 20_000;

  // Prevent hammering indexer revalidations (even if multiple events fire)
  const lastRvAtRef = useRef<number>(0);
  const RV_MIN_GAP_MS = 3_000;

  // ✅ Phase 3: short burst window after user actions so Home reflects changes quickly
  const burstUntilRef = useRef<number>(0);
  const burstTimerRef = useRef<number | null>(null);

  const triggerBurst = useCallback(() => {
    // Only bypass edge cache for a short window after a user action.
    burstUntilRef.current = Date.now() + 5_000;

    // immediate force-fresh refresh (store handles dedupe/throttle/backoff)
    void refreshLotteryStore(true, true);

    // delayed refresh (still within the 5s window) to catch indexer ingest lag
    if (burstTimerRef.current != null) window.clearTimeout(burstTimerRef.current);
    burstTimerRef.current = window.setTimeout(() => {
      if (Date.now() <= burstUntilRef.current) {
        void refreshLotteryStore(true, true);
      }
      burstTimerRef.current = null;
    }, 3_000);
  }, []);

  useEffect(() => {
    return () => {
      if (burstTimerRef.current != null) {
        window.clearTimeout(burstTimerRef.current);
        burstTimerRef.current = null;
      }
    };
  }, []);

  // Store-derived state
  const indexerItems = store.items ?? null;
  const isIndexerLoading = !!store.isLoading;
  const indexerNote = store.note ?? null;

  /**
   * ✅ Soft refresh (used for global revalidate ticks):
   * - refreshes the shared store
   * - does NOT reset mode/live/note (prevents UI "snapping")
   */
  const softRefetch = useCallback(() => {
    // Soft refresh MUST be cached (do NOT force-fresh).
    void refreshLotteryStore(true, false);
  }, []);

  /**
   * ✅ Hard/manual refetch (user-driven):
   * - clears live mode and forces indexer attempt
   */
  const refetch = useCallback(() => {
    setLiveItems(null);
    setLiveLoading(false);
    setMode("indexer");
    setNote(null);
    void refreshLotteryStore(false, true);
  }, []);

  // ✅ Background refresh on revalidate tick (throttled)
  useEffect(() => {
    if (!rvTick) return;

    const now = Date.now();
    if (now - lastRvAtRef.current < RV_MIN_GAP_MS) return;
    lastRvAtRef.current = now;

    softRefetch();
  }, [rvTick, softRefetch]);

  // ✅ Listen to app-wide revalidate events.
  // Only user actions should dispatch { detail: { force: true } }.
  useEffect(() => {
    const onReval = (e: Event) => {
      const ce = e as CustomEvent<{ force?: boolean }>;
      if (ce?.detail?.force) triggerBurst();
      else softRefetch();
    };
    window.addEventListener("ppopgi:revalidate", onReval as any);
    return () => window.removeEventListener("ppopgi:revalidate", onReval as any);
  }, [triggerBurst, softRefetch]);

  // If we have indexer data, always prefer it and exit live mode
  useEffect(() => {
    if (indexerItems && indexerItems.length > 0) {
      setMode("indexer");
      setNote(null);
      setLiveItems(null);
      setLiveLoading(false);
    }
  }, [indexerItems]);

  // If indexer is rate-limited, surface the note but do NOT flip to live
  useEffect(() => {
    if (indexerNote && isRateLimitNote(indexerNote)) {
      setNote(indexerNote);
    }
  }, [indexerNote]);

  // Fallback trigger (only when indexer has no data AND looks down, and only occasionally)
  useEffect(() => {
    const canTry =
      !isIndexerLoading &&
      (!indexerItems || indexerItems.length === 0) &&
      shouldFallback(indexerNote);

    if (!canTry) {
      if (indexerNote && !isRateLimitNote(indexerNote)) setNote(indexerNote);
      return;
    }

    const now = Date.now();
    if (now - lastLiveAtRef.current < LIVE_CACHE_MS) {
      setMode("live");
      setNote("Indexer unavailable. Showing live blockchain data.");
      return;
    }

    lastLiveAtRef.current = now;
    setLiveLoading(true);
    setMode("live");
    setNote("Indexer unavailable. Showing live blockchain data.");

    fetchLotteriesOnChainFallback(50)
      .then((data) => setLiveItems(data))
      .catch((e) => {
        console.error("Home fallback failed", e);
        setNote("Could not load lotteries. Please refresh.");
      })
      .finally(() => setLiveLoading(false));
  }, [indexerItems, isIndexerLoading, indexerNote]);

  // Final items/loading state exposed to UI
  const items: LotteryListItem[] | null = mode === "live" ? liveItems : indexerItems;
  const isLoading = mode === "live" ? liveLoading : isIndexerLoading;

  // ----------------- Derived lists -----------------
  const all = useMemo(() => items ?? [], [items]);

  const active = useMemo(() => {
    return all.filter((r) => r.status === "OPEN" || r.status === "FUNDING_PENDING");
  }, [all]);

  const bigPrizes = useMemo(() => {
    return [...active]
      .sort((a, b) => {
        const A = BigInt(a.winningPot || "0");
        const B = BigInt(b.winningPot || "0");
        if (A === B) return 0;
        return A > B ? -1 : 1;
      })
      .slice(0, 3);
  }, [active]);

  const endingSoon = useMemo(() => {
    return [...active]
      .filter((r) => r.status === "OPEN")
      .sort((a, b) => deadlineSortKey(a.deadline) - deadlineSortKey(b.deadline))
      .slice(0, 5);
  }, [active]);

  /**
   * ✅ Recently Finalized (Settled + Canceled)
   * - Indexer only (live mode returns [])
   * - Sorted by the most recent "final action" timestamp we can find:
   *   drawingRequestedAt -> canceledAt -> registeredAt
   * - Shows the 5 most recent
   */
  const recentlyFinalized = useMemo(() => {
    if (mode === "live") return [];

    const finalized = all.filter((r) => r.status === "COMPLETED" || r.status === "CANCELED");

    return [...finalized]
      .sort((a, b) => {
        const aKey =
          numOr0((a as any).drawingRequestedAt) ||
          numOr0((a as any).canceledAt) ||
          numOr0((a as any).registeredAt);

        const bKey =
          numOr0((b as any).drawingRequestedAt) ||
          numOr0((b as any).canceledAt) ||
          numOr0((b as any).registeredAt);

        return bKey - aKey;
      })
      .slice(0, 5);
  }, [all, mode]);

  return {
    items,
    bigPrizes,
    endingSoon,
    recentlyFinalized,
    mode,
    note,
    isLoading,
    refetch,
  };
}