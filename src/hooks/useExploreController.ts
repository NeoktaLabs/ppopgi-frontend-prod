// src/hooks/useExploreController.ts
import { useState, useMemo, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import type { RaffleListItem, RaffleStatus } from "../indexer/subgraph";

import { useRaffleStore, refresh as refreshRaffleStore } from "./useRaffleStore";

export type SortMode = "endingSoon" | "bigPrize" | "newest";

const norm = (s: string) => (s || "").trim().toLowerCase();
const safeNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isActiveStatus = (s: RaffleStatus) => s === "OPEN" || s === "FUNDING_PENDING";

export function useExploreController() {
  const activeAccount = useActiveAccount();
  const me = activeAccount?.address ? norm(activeAccount.address) : null;

  // ✅ Shared store subscription (single global poller)
  const store = useRaffleStore("explore", 20_000);
  const items: RaffleListItem[] | null = useMemo(() => store.items ?? null, [store.items]);
  const isLoading = !!store.isLoading;
  const note = store.note ?? null;

  // Filters
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<RaffleStatus | "ALL">("ALL");
  const [sort, setSort] = useState<SortMode>("newest");
  const [openOnly, setOpenOnly] = useState(false);
  const [myRafflesOnly, setMyRafflesOnly] = useState(false);

  // --- Filtering Logic (Memoized) ---
  const list = useMemo(() => {
    const all = items ?? [];
    let filtered = status === "ALL" ? all : all.filter((r) => r.status === status);

    if (openOnly) filtered = filtered.filter((r) => isActiveStatus(r.status));

    if (myRafflesOnly && me) {
      filtered = filtered.filter((r: any) => (r.creator ? norm(String(r.creator)) : null) === me);
    }

    const query = norm(q);
    if (query) {
      filtered = filtered.filter((r) =>
        `${r.name || ""} ${r.id || ""}`.toLowerCase().includes(query)
      );
    }

    // IMPORTANT: don’t mutate the original array
    return [...filtered].sort((a, b) => {
      if (sort === "newest") {
        const timeDiff = safeNum(b.lastUpdatedTimestamp) - safeNum(a.lastUpdatedTimestamp);
        return timeDiff !== 0 ? timeDiff : String(b.id).localeCompare(String(a.id));
      }
      if (sort === "endingSoon") return safeNum(a.deadline) - safeNum(b.deadline);
      if (sort === "bigPrize") {
        const A = BigInt(a.winningPot || "0");
        const B = BigInt(b.winningPot || "0");
        return A === B ? 0 : A > B ? -1 : 1;
      }
      return 0;
    });
  }, [items, q, status, sort, openOnly, myRafflesOnly, me]);

  const resetFilters = () => {
    setQ("");
    setStatus("ALL");
    setSort("newest");
    setOpenOnly(false);
    setMyRafflesOnly(false);
  };

  const refresh = useCallback(() => {
    // ✅ force the store to refetch (store dedupes across the whole app)
    void refreshRaffleStore(false, true);
  }, []);

  return {
    state: { items, list, note, q, status, sort, openOnly, myRafflesOnly, me },
    actions: {
      setQ,
      setStatus,
      setSort,
      setOpenOnly,
      setMyRafflesOnly,
      resetFilters,
      refresh,
    },
    meta: { totalCount: items?.length || 0, shownCount: list.length, isLoading },
  };
}