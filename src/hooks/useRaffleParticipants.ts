// src/hooks/useRaffleParticipants.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchRaffleParticipants, type RaffleParticipantItem } from "../indexer/subgraph";

export type ParticipantUI = RaffleParticipantItem & {
  percentage: string;
};

// --- lightweight in-memory cache (per page load) ---
type CacheEntry = {
  at: number;
  data: RaffleParticipantItem[];
  soldAtFetch: number; // helps decide if cache is too stale
};

const CACHE = new Map<string, CacheEntry>();

// How long we reuse cached participants to avoid hammering the indexer
const CACHE_TTL_MS = 30_000;

// Optional: if sold has moved materially since last fetch, refetch even within TTL
const SOLD_DELTA_FORCE_REFRESH = 10;

function isAbortError(err: any) {
  const name = String(err?.name ?? "");
  const msg = String(err?.message ?? err ?? "");
  return name === "AbortError" || msg.toLowerCase().includes("aborted");
}

function isHidden() {
  try {
    return typeof document !== "undefined" && document.hidden;
  } catch {
    return false;
  }
}

export function useRaffleParticipants(raffleId: string | null, totalSold: number) {
  const [raw, setRaw] = useState<RaffleParticipantItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const lastRaffleKeyRef = useRef<string | null>(null);

  const load = useCallback(
    async (opts?: { force?: boolean; reason?: "id_change" | "revalidate" | "manual" }) => {
      if (!raffleId) {
        setRaw([]);
        return;
      }

      const key = raffleId.toLowerCase();
      const now = Date.now();
      const soldNow = Number.isFinite(totalSold) ? totalSold : 0;

      // 1) Cache hit (unless force)
      const cached = CACHE.get(key);

      const cacheFresh = !!cached && now - cached.at < CACHE_TTL_MS;

      const soldMovedALot =
        !!cached &&
        Number.isFinite(cached.soldAtFetch) &&
        Math.abs(soldNow - cached.soldAtFetch) >= SOLD_DELTA_FORCE_REFRESH;

      // If not forced and cache is fresh and sold hasn't moved much, use it
      if (!opts?.force && cached && cacheFresh && !soldMovedALot) {
        setRaw(cached.data);
        return;
      }

      // 2) Abort any in-flight request
      try {
        abortRef.current?.abort();
      } catch {}
      const ac = new AbortController();
      abortRef.current = ac;

      // Only show spinner if we truly have nothing to show
      const hasSomething = (cached?.data?.length ?? raw.length) > 0;
      if (!hasSomething) setIsLoading(true);

      try {
        const data = await fetchRaffleParticipants(key, { signal: ac.signal });

        if (ac.signal.aborted) return;

        CACHE.set(key, { at: now, data: data ?? [], soldAtFetch: soldNow });
        setRaw(data ?? []);
      } catch (err: any) {
        if (isAbortError(err)) return;

        // ✅ Keep showing cached/previous data on error (don’t “blank” the holders list)
        console.error("Failed to load participants", err);

        if (cached?.data?.length) {
          setRaw(cached.data);
        }
      } finally {
        if (!ac.signal.aborted) setIsLoading(false);
      }
    },
    [raffleId, totalSold, raw.length]
  );

  // ✅ Fetch when raffleId changes
  useEffect(() => {
    if (!raffleId) {
      setRaw([]);
      return;
    }

    const key = raffleId.toLowerCase();
    lastRaffleKeyRef.current = key;

    void load({ force: false, reason: "id_change" });

    return () => {
      try {
        abortRef.current?.abort();
      } catch {}
    };
  }, [raffleId, load]);

  // ✅ Refresh holders after buy/create (you already emit "ppopgi:revalidate")
  useEffect(() => {
    const onRevalidate = () => {
      if (!raffleId) return;
      if (isHidden()) return;

      // Light: only refetch if cache is stale-ish OR sold moved a lot
      void load({ force: false, reason: "revalidate" });
    };

    window.addEventListener("ppopgi:revalidate", onRevalidate as any);
    return () => window.removeEventListener("ppopgi:revalidate", onRevalidate as any);
  }, [raffleId, load]);

  // ✅ Recompute percentages locally when totalSold changes (no refetch)
  const participants: ParticipantUI[] = useMemo(() => {
    const sold = Number.isFinite(totalSold) ? totalSold : 0;

    return (raw ?? []).map((p) => {
      const count = Number(p.ticketsPurchased || "0");
      const pct = sold > 0 ? ((count / sold) * 100).toFixed(1) : "0.0";
      return { ...p, percentage: pct };
    });
  }, [raw, totalSold]);

  return {
    participants,
    isLoading,
    refresh: () => load({ force: true, reason: "manual" }),
  };
}