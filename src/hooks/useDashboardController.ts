// src/hooks/useDashboardController.ts
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useActiveAccount, useSendAndConfirmTransaction } from "thirdweb/react";
import { getContract, prepareContractCall, readContract } from "thirdweb";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import {
  fetchMyJoinedRaffleIds,
  fetchMyJoinedRaffleIdsFromEvents,
  fetchRafflesByIds,
  type RaffleListItem,
} from "../indexer/subgraph";
import { useRaffleStore, refresh as refreshRaffleStore } from "./useRaffleStore";

// Minimal ABI for dashboard logic
const RAFFLE_DASH_ABI = [
  { type: "function", name: "withdrawFunds", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "withdrawNative", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "claimTicketRefund", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "ticketsOwned",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimableFunds",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimableNative",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

type JoinedRaffleItem = RaffleListItem & {
  userTicketsOwned: string; // bigint string
};

type ClaimableItem = {
  raffle: RaffleListItem;
  claimableUsdc: string; // bigint string
  claimableNative: string; // bigint string
  type: "WIN" | "REFUND" | "OTHER";
  roles: { participated?: boolean; created?: boolean };
  userTicketsOwned?: string;
};

function isRateLimitError(e: unknown) {
  const msg = String((e as any)?.message ?? e ?? "").toLowerCase();
  return msg.includes("429") || msg.includes("too many requests") || msg.includes("rate");
}

function isVisible() {
  try {
    return document.visibilityState === "visible";
  } catch {
    return true;
  }
}

function toBigInt(v: any): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(v);
    if (typeof v === "string") return BigInt(v || "0");
    if (v?.toString) return BigInt(v.toString());
    return 0n;
  } catch {
    return 0n;
  }
}

function normId(v: string): string {
  const s = String(v || "").toLowerCase();
  if (!s) return s;
  return s.startsWith("0x") ? s : `0x${s}`;
}

/**
 * Simple concurrency pool to avoid hammering RPC.
 */
async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length) as any;
  let i = 0;

  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return out;
}

/**
 * Prioritize likely-claimable raffles so important ones get scanned first.
 */
function scoreForClaimScan(r: RaffleListItem): number {
  if (r.status === "CANCELED") return 100;
  if (r.status === "COMPLETED") return 90;
  if (r.status === "DRAWING") return 50;
  if (r.status === "OPEN") return 20;
  if (r.status === "FUNDING_PENDING") return 10;
  return 0;
}

export function useDashboardController() {
  const accountObj = useActiveAccount();
  const account = accountObj?.address ?? null;
  const { mutateAsync: sendAndConfirm } = useSendAndConfirmTransaction();

  const store = useRaffleStore("dashboard", 15_000);
  const allRaffles = useMemo(() => store.items ?? [], [store.items]);

  const [created, setCreated] = useState<RaffleListItem[]>([]);
  const [joined, setJoined] = useState<JoinedRaffleItem[]>([]);
  const [claimables, setClaimables] = useState<ClaimableItem[]>([]);
  const [localPending, setLocalPending] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [hiddenClaimables, setHiddenClaimables] = useState<Record<string, boolean>>({});

  // Cache + single-flight joinedIds
  const lastJoinedIdsRef = useRef<{ ts: number; account: string; ids: Set<string> } | null>(null);
  const joinedIdsPromiseRef = useRef<Promise<Set<string>> | null>(null);
  const joinedBackoffMsRef = useRef(0);

  const runIdRef = useRef(0);

  // Reset on wallet change
  useEffect(() => {
    lastJoinedIdsRef.current = null;
    joinedIdsPromiseRef.current = null;
    joinedBackoffMsRef.current = 0;
    setHiddenClaimables({});
    setMsg(null);
    setCreated([]);
    setJoined([]);
    setClaimables([]);
  }, [account]);

  /**
   * ✅ Everyone awaits the SAME in-flight promise.
   * ✅ Participants first; events only if participants returns empty.
   * ✅ No maxPages param (avoids TS errors).
   */
  const getJoinedIds = useCallback(async (): Promise<Set<string>> => {
    if (!account) return new Set<string>();

    const acct = account.toLowerCase();
    const now = Date.now();
    const cached = lastJoinedIdsRef.current;

    if (cached && cached.account === acct && now - cached.ts < 60_000) return cached.ids;
    if (joinedIdsPromiseRef.current) return await joinedIdsPromiseRef.current;

    joinedIdsPromiseRef.current = (async () => {
      const ids = new Set<string>();

      try {
        // Primary: raffleParticipants aggregation (fast + direct)
        try {
          let skip = 0;
          const pageSize = 1000;
          const maxPages = 5;

          for (let pageN = 0; pageN < maxPages; pageN++) {
            const page = await fetchMyJoinedRaffleIds(account, { first: pageSize, skip });
            page.forEach((id) => ids.add(normId(id)));
            if (page.length < pageSize) break;
            skip += pageSize;
          }
        } catch (e) {
          console.warn("[dash] fetchMyJoinedRaffleIds failed", e);
        }

        // Fallback: events only if still empty
        if (ids.size === 0) {
          try {
            let skip = 0;
            const pageSize = 1000;
            const maxPages = 8;

            for (let pageN = 0; pageN < maxPages; pageN++) {
              const page = await fetchMyJoinedRaffleIdsFromEvents(account, { first: pageSize, skip });
              page.forEach((id) => ids.add(normId(id)));
              if (page.length < pageSize) break;
              skip += pageSize;
            }
          } catch (e) {
            console.warn("[dash] fetchMyJoinedRaffleIdsFromEvents failed", e);
          }
        }

        lastJoinedIdsRef.current = { ts: Date.now(), account: acct, ids };
        joinedBackoffMsRef.current = 0;
        return ids;
      } catch (e) {
        if (isRateLimitError(e)) {
          const cur = joinedBackoffMsRef.current || 0;
          joinedBackoffMsRef.current = cur === 0 ? 15_000 : Math.min(cur * 2, 120_000);
          setMsg("Indexer rate-limited. Retrying shortly…");
        }
        return cached?.account === acct ? cached.ids : new Set<string>();
      } finally {
        joinedIdsPromiseRef.current = null;
      }
    })();

    return await joinedIdsPromiseRef.current;
  }, [account]);

  const recompute = useCallback(
    async (isBackground = false) => {
      const runId = ++runIdRef.current;

      if (!account) {
        setCreated([]);
        setJoined([]);
        setClaimables([]);
        setLocalPending(false);
        return;
      }

      if (isBackground && !isVisible()) return;

      if (!store.items) {
        if (!isBackground) setLocalPending(true);
        return;
      }

      // show loader only on true cold load
      if (!isBackground) {
        const nothingYet = created.length === 0 && joined.length === 0 && claimables.length === 0;
        if (nothingYet) setLocalPending(true);
      }

      try {
        const myAddr = account.toLowerCase();

        const myCreated = allRaffles.filter((r) => r.creator?.toLowerCase() === myAddr);

        const joinedIds = await getJoinedIds();
        if (runId !== runIdRef.current) return;

        const joinedIdArr = Array.from(joinedIds);

        const joinedBaseFromStore =
          joinedIdArr.length === 0 ? [] : allRaffles.filter((r) => joinedIds.has(normId(r.id)));

        // ✅ Always update created (cheap / no flicker)
        setCreated(myCreated);

        // ✅ IMPORTANT: Don't "paint 0 tickets" on background refresh.
        // Only do this on a true cold load where we have no joined yet.
        const hasJoinedAlready = joined.length > 0;
        if (!hasJoinedAlready) {
          setJoined(joinedBaseFromStore.map((r) => ({ ...r, userTicketsOwned: "0" })));
        }

        // Fetch full raffle objects by ids (more reliable)
        let joinedBase: RaffleListItem[] = joinedBaseFromStore;
        if (joinedIdArr.length > 0) {
          try {
            const fetched = await fetchRafflesByIds(joinedIdArr);
            if (runId !== runIdRef.current) return;
            if (fetched.length > 0) joinedBase = fetched;
          } catch {}
        }

        // Enrich ticketsOwned
        const ownedByRaffleId = new Map<string, string>();
        const joinedToCheck = joinedBase.slice(0, 120);

        await mapPool(joinedToCheck, 12, async (r) => {
          try {
            const contract = getContract({
              client: thirdwebClient,
              chain: ETHERLINK_CHAIN,
              address: r.id,
              abi: RAFFLE_DASH_ABI,
            });

            const owned = await readContract({ contract, method: "ticketsOwned", params: [account] });
            ownedByRaffleId.set(normId(r.id), toBigInt(owned).toString());
          } catch {
            ownedByRaffleId.set(normId(r.id), "0");
          }
        });

        if (runId !== runIdRef.current) return;

        const nextJoined: JoinedRaffleItem[] = joinedBase.map((r) => ({
          ...r,
          userTicketsOwned: ownedByRaffleId.get(normId(r.id)) ?? "0",
        }));

        // ✅ Only update joined if it actually changed (prevents tiny “refresh” feeling)
        setJoined((prev) => {
          if (prev.length !== nextJoined.length) return nextJoined;
          for (let i = 0; i < prev.length; i++) {
            if (normId(prev[i].id) !== normId(nextJoined[i].id)) return nextJoined;
            if (String(prev[i].userTicketsOwned) !== String(nextJoined[i].userTicketsOwned)) return nextJoined;
          }
          return prev;
        });

        // Claimables: only real actions
        const candidateById = new Map<string, RaffleListItem>();
        myCreated.forEach((r) => candidateById.set(normId(r.id), r));
        joinedBase.forEach((r) => candidateById.set(normId(r.id), r));

        const uniqueCandidates = Array.from(candidateById.values());
        uniqueCandidates.sort((a, b) => {
          const sa = scoreForClaimScan(a);
          const sb = scoreForClaimScan(b);
          if (sb !== sa) return sb - sa;
          return Number(b.lastUpdatedTimestamp || "0") - Number(a.lastUpdatedTimestamp || "0");
        });

        const candidates = uniqueCandidates.slice(0, 400);
        const newClaimables: ClaimableItem[] = [];

        await mapPool(candidates, 10, async (r) => {
          const contract = getContract({
            client: thirdwebClient,
            chain: ETHERLINK_CHAIN,
            address: r.id,
            abi: RAFFLE_DASH_ABI,
          });

          let cf = 0n;
          let cn = 0n;
          let ticketsOwned = 0n;

          try {
            cf = toBigInt(await readContract({ contract, method: "claimableFunds", params: [account] }));
          } catch {}
          try {
            cn = toBigInt(await readContract({ contract, method: "claimableNative", params: [account] }));
          } catch {}
          try {
            ticketsOwned = toBigInt(await readContract({ contract, method: "ticketsOwned", params: [account] }));
          } catch {}

          const roles = {
            created: r.creator?.toLowerCase() === myAddr,
            participated: ticketsOwned > 0n || joinedIds.has(normId(r.id)),
          };

          const isWinnerEligible =
            r.status === "COMPLETED" &&
            r.winner?.toLowerCase() === myAddr &&
            (cf > 0n || cn > 0n);

          const isParticipantRefundEligible = r.status === "CANCELED" && ticketsOwned > 0n;

          const isAnythingClaimable = cf > 0n || cn > 0n;

          if (!isWinnerEligible && !isParticipantRefundEligible && !isAnythingClaimable) return;

          if (isWinnerEligible) {
            newClaimables.push({
              raffle: r,
              claimableUsdc: cf.toString(),
              claimableNative: cn.toString(),
              type: "WIN",
              roles,
              userTicketsOwned: ticketsOwned.toString(),
            });
            return;
          }

          if (isParticipantRefundEligible) {
            newClaimables.push({
              raffle: r,
              claimableUsdc: cf.toString(),
              claimableNative: cn.toString(),
              type: "REFUND",
              roles,
              userTicketsOwned: ticketsOwned.toString(),
            });
            return;
          }

          newClaimables.push({
            raffle: r,
            claimableUsdc: cf.toString(),
            claimableNative: cn.toString(),
            type: "OTHER",
            roles,
            userTicketsOwned: ticketsOwned.toString(),
          });
        });

        if (runId !== runIdRef.current) return;
        setClaimables(newClaimables);
      } catch (e) {
        console.error("Dashboard recompute error", e);
        if (!isBackground) setMsg("Failed to load dashboard data.");
      } finally {
        if (!isBackground) setLocalPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account, allRaffles, getJoinedIds, store.items, created.length, joined.length, claimables.length]
  );

  useEffect(() => {
    if (!account) {
      setLocalPending(false);
      return;
    }
    void (async () => {
      await refreshRaffleStore(false, true);
      await recompute(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  useEffect(() => {
    if (!account) return;
    void recompute(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, store.lastUpdatedMs]);

  useEffect(() => {
    const onFocus = () => {
      void refreshRaffleStore(true, true);
      void recompute(true);
    };

    const onVis = () => {
      if (document.visibilityState === "visible") {
        void refreshRaffleStore(true, true);
        void recompute(true);
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [recompute]);

  const createdSorted = useMemo(
    () => [...created].sort((a, b) => Number(b.lastUpdatedTimestamp || "0") - Number(a.lastUpdatedTimestamp || "0")),
    [created]
  );

  const joinedSorted = useMemo(
    () => [...joined].sort((a, b) => Number(b.lastUpdatedTimestamp || "0") - Number(a.lastUpdatedTimestamp || "0")),
    [joined]
  );

  const claimablesSorted = useMemo(
    () => claimables.filter((c) => !hiddenClaimables[normId(c.raffle.id)]),
    [claimables, hiddenClaimables]
  );

  const withdraw = async (raffleId: string, method: "withdrawFunds" | "withdrawNative" | "claimTicketRefund") => {
    if (!account) return;
    setMsg(null);

    try {
      const c = getContract({
        client: thirdwebClient,
        chain: ETHERLINK_CHAIN,
        address: raffleId,
        abi: RAFFLE_DASH_ABI,
      });

      await sendAndConfirm(prepareContractCall({ contract: c, method, params: [] }));

      setHiddenClaimables((p) => ({ ...p, [normId(raffleId)]: true }));
      setMsg("Claim successful.");

      lastJoinedIdsRef.current = null;
      joinedBackoffMsRef.current = 0;

      await refreshRaffleStore(true, true);
      await recompute(true);
    } catch (e) {
      console.error("Withdraw failed", e);
      setMsg("Claim failed or rejected.");
    }
  };

  const refresh = async () => {
    setMsg(null);
    setHiddenClaimables({});
    lastJoinedIdsRef.current = null;
    joinedBackoffMsRef.current = 0;

    await refreshRaffleStore(false, true);
    await recompute(false);
  };

  // Optional UI flags (do not break existing callers)
  const hasBootstrapped = !!store.items;
  const isColdLoading = !hasBootstrapped && (localPending || store.isLoading);
  const isRefreshing = hasBootstrapped && store.isLoading;

  return {
    data: {
      created: createdSorted,
      joined: joinedSorted,
      claimables: claimablesSorted,
      msg,
      isPending: localPending || store.isLoading,
      isColdLoading,
      isRefreshing,
      storeNote: store.note,
      storeLastUpdatedMs: store.lastUpdatedMs,
      joinedBackoffMs: joinedBackoffMsRef.current,
    },
    actions: { withdraw, refresh },
    account,
  };
}