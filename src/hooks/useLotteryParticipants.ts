// src/hooks/useLotteryParticipants.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchUserLotteriesByLottery, type UserLotteryItem } from "../indexer/subgraph";

export type ParticipantUI = UserLotteryItem & { percentage: string };

type CacheEntry = {
  at: number;
  data: UserLotteryItem[];
  soldAtFetch: number;
};

const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;
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

export function useLotteryParticipants(lotteryId: string | null, totalSold: number) {
  const [raw, setRaw] = useState<UserLotteryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);
  const rawRef = useRef<UserLotteryItem[]>([]);
  rawRef.current = raw;

  const soldRef = useRef(0);
  soldRef.current = Number.isFinite(totalSold) ? totalSold : 0;

  const lastRevalRef = useRef(0);

  // ✅ prevent overlapping loads
  const inFlightRef = useRef(false);

  const load = useCallback(
    async (opts?: { force?: boolean; reason?: "id_change" | "revalidate" | "manual" }) => {
      if (!lotteryId) {
        setRaw([]);
        setIsLoading(false);
        return;
      }

      const key = lotteryId.toLowerCase();
      const now = Date.now();
      const soldNow = soldRef.current;

      const cached = CACHE.get(key);
      const cacheFresh = !!cached && now - cached.at < CACHE_TTL_MS;
      const soldMovedALot =
        !!cached &&
        Number.isFinite(cached.soldAtFetch) &&
        Math.abs(soldNow - cached.soldAtFetch) >= SOLD_DELTA_FORCE_REFRESH;

      if (!opts?.force && cached && cacheFresh && !soldMovedALot) {
        setRaw(cached.data);
        setIsLoading(false);
        return;
      }

      // ✅ do not start a new request if one is already running
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const myReqId = ++reqIdRef.current;

      const ac = new AbortController();
      abortRef.current = ac;

      const hasSomething = (cached?.data?.length ?? rawRef.current.length) > 0;
      if (!hasSomething) setIsLoading(true);

      try {
        const data = await fetchUserLotteriesByLottery(key, { first: 1000, signal: ac.signal });
        if (myReqId !== reqIdRef.current) return;

        CACHE.set(key, { at: Date.now(), data: data ?? [], soldAtFetch: soldNow });
        setRaw(data ?? []);
      } catch (err: any) {
        if (myReqId !== reqIdRef.current) return;
        if (isAbortError(err)) return;

        console.error("Failed to load participants", err);
        if (cached?.data?.length) setRaw(cached.data);
      } finally {
        if (myReqId === reqIdRef.current) setIsLoading(false);
        inFlightRef.current = false;
      }
    },
    [lotteryId]
  );

  useEffect(() => {
    if (!lotteryId) {
      setRaw([]);
      setIsLoading(false);
      return;
    }

    void load({ force: false, reason: "id_change" });

    return () => {
      try {
        abortRef.current?.abort();
      } catch {}
    };
  }, [lotteryId, load]);

  useEffect(() => {
    const onRevalidate = () => {
      if (!lotteryId) return;
      if (isHidden()) return;

      const now = Date.now();
      if (now - lastRevalRef.current < 750) return;
      lastRevalRef.current = now;

      void load({ force: false, reason: "revalidate" });
    };

    window.addEventListener("ppopgi:revalidate", onRevalidate as any);
    return () => window.removeEventListener("ppopgi:revalidate", onRevalidate as any);
  }, [lotteryId, load]);

  const participants: ParticipantUI[] = useMemo(() => {
    const sold = soldRef.current;

    // ✅ FIX: hide "0 tickets" rows (e.g. creator placeholder entries)
    return (raw ?? [])
      .filter((p) => Number(p.ticketsPurchased || "0") > 0)
      .map((p) => {
        const count = Number(p.ticketsPurchased || "0");
        const pct = sold > 0 ? ((count / sold) * 100).toFixed(1) : "0.0";
        return { ...p, percentage: pct };
      });
  }, [raw]);

  return { participants, isLoading, refresh: () => load({ force: true, reason: "manual" }) };
}