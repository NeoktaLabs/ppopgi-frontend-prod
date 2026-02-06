// src/hooks/useRaffleParticipants.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchRaffleParticipants, type RaffleParticipantItem } from "../indexer/subgraph";

export type ParticipantUI = RaffleParticipantItem & {
  percentage: string;
};

// --- lightweight in-memory cache (per page load) ---
type CacheEntry = { at: number; data: RaffleParticipantItem[] };
const CACHE = new Map<string, CacheEntry>();

// How long we reuse cached participants to avoid hammering the indexer
const CACHE_TTL_MS = 30_000;

export function useRaffleParticipants(raffleId: string | null, totalSold: number) {
  const [raw, setRaw] = useState<RaffleParticipantItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!raffleId) {
        setRaw([]);
        return;
      }

      // 1) Cache hit (unless force)
      const key = raffleId.toLowerCase();
      const cached = CACHE.get(key);
      const now = Date.now();

      if (!opts?.force && cached && now - cached.at < CACHE_TTL_MS) {
        setRaw(cached.data);
        return;
      }

      // 2) Abort any in-flight request
      try {
        abortRef.current?.abort();
      } catch {}
      const ac = new AbortController();
      abortRef.current = ac;

      setIsLoading(true);
      try {
        // Tip: You can also reduce pressure by limiting first/skip inside fetchRaffleParticipants if needed
        const data = await fetchRaffleParticipants(key, { signal: ac.signal });

        // If we were aborted, stop quietly
        if (ac.signal.aborted) return;

        CACHE.set(key, { at: now, data });
        setRaw(data);
      } catch (err: any) {
        if (String(err?.name || "").toLowerCase().includes("abort")) return;
        if (String(err).toLowerCase().includes("abort")) return;
        console.error("Failed to load participants", err);
      } finally {
        if (!ac.signal.aborted) setIsLoading(false);
      }
    },
    [raffleId]
  );

  // ✅ Fetch ONLY when raffleId changes (NOT when totalSold changes)
  useEffect(() => {
    if (!raffleId) {
      setRaw([]);
      return;
    }
    load({ force: false });

    return () => {
      try {
        abortRef.current?.abort();
      } catch {}
    };
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
    // Optional manual refresh if you ever want a "Refresh holders" button
    refresh: () => load({ force: true }),
  };
}