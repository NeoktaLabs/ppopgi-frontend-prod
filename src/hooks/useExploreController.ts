// src/hooks/useExploreController.ts
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useActiveAccount } from "thirdweb/react";
import type { LotteryListItem, LotteryStatus } from "../indexer/subgraph";

import { useLotteryStore, refresh as refreshLotteryStore } from "./useLotteryStore";

export type SortMode = "endingSoon" | "bigPrize" | "newest";

const norm = (s: string) => (s || "").trim().toLowerCase();

const safeNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const isActiveStatus = (s: LotteryStatus) => s === "OPEN" || s === "FUNDING_PENDING";

export function useExploreController() {
  const activeAccount = useActiveAccount();
  const me = activeAccount?.address ? norm(activeAccount.address) : null;

  // ✅ Shared store subscription (single global poller)
  const store = useLotteryStore("explore", 20_000);
  const items: LotteryListItem[] | null = useMemo(() => store.items ?? null, [store.items]);
  const isLoading = !!store.isLoading;
  const note = store.note ?? null;

  // Filters
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<LotteryStatus | "ALL">("ALL");
  const [sort, setSort] = useState<SortMode>("newest");
  const [openOnly, setOpenOnly] = useState(false);
  const [myLotteriesOnly, setMyLotteriesOnly] = useState(false);

  // --- Filtering Logic (Memoized) ---
  const list = useMemo(() => {
    const all = items ?? [];

    let filtered = status === "ALL" ? all : all.filter((r) => r.status === status);

    if (openOnly) filtered = filtered.filter((r) => isActiveStatus(r.status));

    if (myLotteriesOnly && me) {
      filtered = filtered.filter((r) => (r.creator ? norm(String(r.creator)) : null) === me);
    }

    const query = norm(q);
    if (query) {
      filtered = filtered.filter((r) => `${r.name || ""} ${r.id || ""}`.toLowerCase().includes(query));
    }

    // IMPORTANT: don’t mutate the original array
    return [...filtered].sort((a, b) => {
      if (sort === "newest") {
        // Lottery list ordering is by registeredAt desc
        const timeDiff = safeNum(b.registeredAt) - safeNum(a.registeredAt);
        return timeDiff !== 0 ? timeDiff : String(b.id).localeCompare(String(a.id));
      }

      if (sort === "endingSoon") {
        // Push missing/0 deadlines to the bottom
        const ad = safeNum(a.deadline);
        const bd = safeNum(b.deadline);

        const aKey = ad > 0 ? ad : Number.MAX_SAFE_INTEGER;
        const bKey = bd > 0 ? bd : Number.MAX_SAFE_INTEGER;

        return aKey - bKey;
      }

      if (sort === "bigPrize") {
        const A = BigInt(a.winningPot || "0");
        const B = BigInt(b.winningPot || "0");
        return A === B ? 0 : A > B ? -1 : 1;
      }

      return 0;
    });
  }, [items, q, status, sort, openOnly, myLotteriesOnly, me]);

  const resetFilters = () => {
    setQ("");
    setStatus("ALL");
    setSort("newest");
    setOpenOnly(false);
    setMyLotteriesOnly(false);
  };

  /**
   * ✅ Phase 3 behavior:
   * - Normal refresh button => force store fetch (still uses edge cache; store handles revalidate throttles)
   * - After user actions (ppopgi:revalidate) => do a short "freshness burst" by forcing store fetch
   *   (your worker will bypass edge cache only when fetchers set x-force-fresh; the store itself is list data,
   *    and already uses periodic polling + revalidate throttling, so here we just ensure it runs immediately).
   */
  const refresh = useCallback(() => {
    void refreshLotteryStore(false, true);
  }, []);

  // ✅ Listen to app-wide revalidate so Explore reflects actions quickly (even if user stays on Explore)
  const burstUntilRef = useRef(0);
  const burstTimerRef = useRef<number | null>(null);

  const triggerBurst = useCallback(() => {
    // Only bypass edge cache briefly after a user action.
    burstUntilRef.current = Date.now() + 5_000;

    // immediate force-fresh fetch
    void refreshLotteryStore(true, true);

    // one delayed fetch (still within 5s) to catch subgraph ingest lag
    if (burstTimerRef.current != null) window.clearTimeout(burstTimerRef.current);
    burstTimerRef.current = window.setTimeout(() => {
      if (Date.now() <= burstUntilRef.current) {
        void refreshLotteryStore(true, true);
      }
      burstTimerRef.current = null;
    }, 3_000);
  }, []);

  useEffect(() => {
    const onReval = (e: Event) => {
      const ce = e as CustomEvent<{ force?: boolean }>;
      const forced = !!ce?.detail?.force;

      if (forced) triggerBurst();
      else void refreshLotteryStore(true, false);
    };

    window.addEventListener("ppopgi:revalidate", onReval as any);
    return () => {
      window.removeEventListener("ppopgi:revalidate", onReval as any);
      if (burstTimerRef.current != null) {
        window.clearTimeout(burstTimerRef.current);
        burstTimerRef.current = null;
      }
    };
  }, [triggerBurst]);

  return {
    state: { items, list, note, q, status, sort, openOnly, myLotteriesOnly, me },
    actions: {
      setQ,
      setStatus,
      setSort,
      setOpenOnly,
      setMyLotteriesOnly,
      resetFilters,
      refresh,
    },
    meta: { totalCount: items?.length || 0, shownCount: list.length, isLoading },
  };
}