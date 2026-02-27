// src/hooks/useDashboardController.ts
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useActiveAccount, useSendAndConfirmTransaction } from "thirdweb/react";
import { getContract, prepareContractCall, readContract } from "thirdweb";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import {
  fetchUserLotteriesByUser,
  fetchLotteryById,
  fetchLotteriesByFeeRecipient,
  type LotteryListItem,
  type UserLotteryItem,
} from "../indexer/subgraph";
import { useLotteryStore, refresh as refreshLotteryStore } from "./useLotteryStore";

// ✅ Use full ABI from your folder (better decoding, no drift)
import { SingleWinnerLotteryABI } from "../config/abis/index";

type JoinedLotteryItem = LotteryListItem & {
  // From subgraph UserLotteryItem (historical)
  userTicketsPurchased?: string;
  userUsdcSpent?: string;
  userFundsClaimedAmount?: string;
  userTicketRefundAmount?: string;

  // From chain (current)
  userTicketsOwned: string; // bigint string
  userClaimableFunds: string; // bigint string
  userRefundNow: string; // bigint string (computed: ticketsOwned * ticketPrice when canceled)
};

type ClaimableItem = {
  lottery: LotteryListItem;
  claimableUsdc: string; // bigint string
  refundUsdc: string; // bigint string
  totalUsdc: string; // bigint string
  type: "WIN" | "REFUND" | "OTHER";
  roles: { participated?: boolean; created?: boolean; feeRecipient?: boolean; winner?: boolean };
  userTicketsOwned: string;
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
 * Simple concurrency pool to avoid hammering RPC/subgraph.
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

function scoreForClaimScan(r: LotteryListItem): number {
  if (r.status === "CANCELED") return 100;
  if (r.status === "COMPLETED") return 90;
  if (r.status === "DRAWING") return 50;
  if (r.status === "OPEN") return 20;
  if (r.status === "FUNDING_PENDING") return 10;
  return 0;
}

/**
 * Read claimableFunds + ticketsOwned with a short-lived cache.
 * Never throws; failures become 0.
 */
async function readDashboardValues(args: {
  lotteryId: string;
  account: string;
  cache: Map<string, { ts: number; cf: string; owned: string }>;
  ttlMs: number;
}) {
  const { lotteryId, account, cache, ttlMs } = args;

  const lid = normId(lotteryId);
  const acct = account.toLowerCase();
  const key = `${acct}:${lid}`;

  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < ttlMs) {
    return { cf: hit.cf, owned: hit.owned };
  }

  const contract = getContract({
    client: thirdwebClient,
    chain: ETHERLINK_CHAIN,
    address: lid,
    abi: SingleWinnerLotteryABI as any,
  });

  let cf = "0";
  let owned = "0";

  try {
    cf = toBigInt(await readContract({ contract, method: "claimableFunds", params: [account] })).toString();
  } catch {}
  try {
    owned = toBigInt(await readContract({ contract, method: "ticketsOwned", params: [account] })).toString();
  } catch {}

  cache.set(key, { ts: now, cf, owned });
  return { cf, owned };
}

/**
 * Paged feeRecipient fetch (your subgraph API already supports paging by first/skip).
 */
async function fetchAllByFeeRecipientPaged(
  feeRecipient: string,
  opts: { pageSize: number; maxPages: number }
): Promise<LotteryListItem[]> {
  const pageSize = Math.min(Math.max(opts.pageSize, 1), 1000);
  const maxPages = Math.min(Math.max(opts.maxPages, 1), 50);

  const out: LotteryListItem[] = [];
  let skip = 0;

  for (let i = 0; i < maxPages; i++) {
    const page = await fetchLotteriesByFeeRecipient(feeRecipient, { first: pageSize, skip });
    out.push(...(page ?? []));
    if (!page || page.length < pageSize) break;
    skip += pageSize;
  }

  // dedup
  const m = new Map<string, LotteryListItem>();
  for (const r of out) m.set(normId(r.id), { ...r, id: normId(r.id) });
  return Array.from(m.values());
}

export function useDashboardController() {
  const accountObj = useActiveAccount();
  const account = accountObj?.address ?? null;
  const { mutateAsync: sendAndConfirm } = useSendAndConfirmTransaction();

  const store = useLotteryStore("dashboard", 15_000);
  const allLotteries = useMemo(() => (store.items ?? []) as LotteryListItem[], [store.items]);

  const [created, setCreated] = useState<LotteryListItem[]>([]);
  const [joined, setJoined] = useState<JoinedLotteryItem[]>([]);
  const [claimables, setClaimables] = useState<ClaimableItem[]>([]);
  const [localPending, setLocalPending] = useState(true);
  const [txPending, setTxPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hiddenClaimables, setHiddenClaimables] = useState<Record<string, boolean>>({});

  const runIdRef = useRef(0);

  const userLotsCacheRef = useRef<{ ts: number; account: string; rows: UserLotteryItem[] } | null>(null);
  const userLotsPromiseRef = useRef<Promise<UserLotteryItem[]> | null>(null);
  const userLotsBackoffMsRef = useRef(0);

  const feeLotsCacheRef = useRef<{ ts: number; account: string; lotteries: LotteryListItem[] } | null>(null);
  const feeLotsPromiseRef = useRef<Promise<LotteryListItem[]> | null>(null);
  const feeLotsBackoffMsRef = useRef(0);

  const byIdCacheRef = useRef<Map<string, { ts: number; item: LotteryListItem | null }>>(new Map());

  const rpcCacheRef = useRef<Map<string, { ts: number; cf: string; owned: string }>>(new Map());
  const lastBgRunRef = useRef(0);
  const rpcConcurrencyRef = useRef({ claimScan: 10, fillById: 8 });

  const claimScanCursorRef = useRef(0);

  useEffect(() => {
    userLotsCacheRef.current = null;
    userLotsPromiseRef.current = null;
    userLotsBackoffMsRef.current = 0;

    feeLotsCacheRef.current = null;
    feeLotsPromiseRef.current = null;
    feeLotsBackoffMsRef.current = 0;

    byIdCacheRef.current = new Map();
    rpcCacheRef.current = new Map();
    lastBgRunRef.current = 0;
    rpcConcurrencyRef.current = { claimScan: 10, fillById: 8 };
    claimScanCursorRef.current = 0;

    setHiddenClaimables({});
    setMsg(null);
    setCreated([]);
    setJoined([]);
    setClaimables([]);
    setLocalPending(true);
    setTxPending(false);
  }, [account]);

  const getUserLotteries = useCallback(async (): Promise<UserLotteryItem[]> => {
    if (!account) return [];
    const acct = account.toLowerCase();
    const now = Date.now();

    const cached = userLotsCacheRef.current;

    const backoff = userLotsBackoffMsRef.current || 0;
    if (backoff > 0 && cached && cached.account === acct) {
      if (now - cached.ts < backoff) return cached.rows;
    }

    if (cached && cached.account === acct && now - cached.ts < 60_000) return cached.rows;
    if (userLotsPromiseRef.current) return await userLotsPromiseRef.current;

    userLotsPromiseRef.current = (async () => {
      try {
        const rows = await fetchUserLotteriesByUser(acct, { first: 1000, skip: 0 });
        userLotsCacheRef.current = { ts: Date.now(), account: acct, rows: rows ?? [] };
        userLotsBackoffMsRef.current = 0;
        return rows ?? [];
      } catch (e) {
        if (isRateLimitError(e)) {
          const cur = userLotsBackoffMsRef.current || 0;
          userLotsBackoffMsRef.current = cur === 0 ? 15_000 : Math.min(cur * 2, 120_000);
        }
        return cached?.account === acct ? cached.rows : [];
      } finally {
        userLotsPromiseRef.current = null;
      }
    })();

    return await userLotsPromiseRef.current;
  }, [account]);

  const getFeeRecipientLotteries = useCallback(async (): Promise<LotteryListItem[]> => {
    if (!account) return [];
    const acct = account.toLowerCase();
    const now = Date.now();

    const cached = feeLotsCacheRef.current;

    const backoff = feeLotsBackoffMsRef.current || 0;
    if (backoff > 0 && cached && cached.account === acct) {
      if (now - cached.ts < backoff) return cached.lotteries;
    }

    if (cached && cached.account === acct && now - cached.ts < 2 * 60_000) return cached.lotteries;
    if (feeLotsPromiseRef.current) return await feeLotsPromiseRef.current;

    feeLotsPromiseRef.current = (async () => {
      try {
        const lotteries = await fetchAllByFeeRecipientPaged(acct, { pageSize: 200, maxPages: 10 });
        feeLotsCacheRef.current = { ts: Date.now(), account: acct, lotteries };
        feeLotsBackoffMsRef.current = 0;
        return lotteries;
      } catch (e) {
        if (isRateLimitError(e)) {
          const cur = feeLotsBackoffMsRef.current || 0;
          feeLotsBackoffMsRef.current = cur === 0 ? 15_000 : Math.min(cur * 2, 120_000);
        }
        return cached?.account === acct ? cached.lotteries : [];
      } finally {
        feeLotsPromiseRef.current = null;
      }
    })();

    return await feeLotsPromiseRef.current;
  }, [account]);

  async function fillMissingLotteriesById(ids: string[], runId: number): Promise<LotteryListItem[]> {
    const cache = byIdCacheRef.current;
    const now = Date.now();
    const ttl = 2 * 60_000;

    const uniq = Array.from(new Set(ids.map(normId))).filter(Boolean);

    const hits: LotteryListItem[] = [];
    const missing: string[] = [];

    for (const id of uniq) {
      const c = cache.get(id);
      if (c && now - c.ts < ttl) {
        if (c.item) hits.push(c.item);
      } else {
        missing.push(id);
      }
    }

    if (missing.length === 0) return hits;

    const fetched = await mapPool(missing, rpcConcurrencyRef.current.fillById, async (id) => {
      try {
        const item = await fetchLotteryById(id);
        if (runId !== runIdRef.current) return null;
        cache.set(id, { ts: Date.now(), item });
        return item;
      } catch {
        cache.set(id, { ts: Date.now(), item: null });
        return null;
      }
    });

    const got = fetched.filter(Boolean) as LotteryListItem[];
    return [...hits, ...got];
  }

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
      if (isBackground && txPending) return;

      if (isBackground) {
        const now = Date.now();
        if (now - lastBgRunRef.current < 6_000) return;
        lastBgRunRef.current = now;
      }

      if (!store.items) {
        if (!isBackground) setLocalPending(true);
        return;
      }

      if (!isBackground) {
        const nothingYet = created.length === 0 && joined.length === 0 && claimables.length === 0;
        if (nothingYet) setLocalPending(true);
      }

      try {
        const myAddr = account.toLowerCase();

        const myCreated = allLotteries.filter((r) => (r.creator || "").toLowerCase() === myAddr);
        setCreated(myCreated);

        const userLots = await getUserLotteries();
        if (runId !== runIdRef.current) return;

        // ✅ All rows for this user (keep for claim history & roles)
        const joinedRowsAll = (userLots ?? []).filter((x) => (x.user || "").toLowerCase() === myAddr);

        // ✅ Joined tab should mean "actually bought tickets"
        //    Prevents creator/feeRecipient rows that exist for accounting but have 0 tickets.
        const joinedRowsPurchased = joinedRowsAll.filter((x) => {
          try {
            return BigInt(x.ticketsPurchased ?? "0") > 0n;
          } catch {
            return false;
          }
        });

        // ✅ Joined IDs only from purchased rows
        const joinedIds = joinedRowsPurchased.map((x) => normId(x.lottery));

        const storeById = new Map<string, LotteryListItem>();
        for (const r of allLotteries) storeById.set(normId(r.id), { ...r, id: normId(r.id) });

        const baseFromStore: LotteryListItem[] = [];
        const missingIds: string[] = [];

        for (const id of joinedIds) {
          const hit = storeById.get(id);
          if (hit) baseFromStore.push(hit);
          else missingIds.push(id);
        }

        let filled: LotteryListItem[] = [];
        if (missingIds.length > 0 && isVisible()) {
          filled = await fillMissingLotteriesById(missingIds, runId);
          if (runId !== runIdRef.current) return;
        }

        const joinedBaseMap = new Map<string, LotteryListItem>();
        for (const r of baseFromStore) joinedBaseMap.set(normId(r.id), r);
        for (const r of filled) joinedBaseMap.set(normId(r.id), { ...r, id: normId(r.id) });
        const joinedBase = Array.from(joinedBaseMap.values());

        let myFeeLots: LotteryListItem[] = [];
        if (isVisible()) {
          myFeeLots = await getFeeRecipientLotteries();
        }
        if (runId !== runIdRef.current) return;

        const candidatesMap = new Map<string, LotteryListItem>();
        for (const r of myCreated) candidatesMap.set(normId(r.id), { ...r, id: normId(r.id) });
        for (const r of joinedBase) candidatesMap.set(normId(r.id), { ...r, id: normId(r.id) });
        for (const r of myFeeLots) candidatesMap.set(normId(r.id), { ...r, id: normId(r.id) });

        const candidatesAll = Array.from(candidatesMap.values())
          .sort((a, b) => {
            const sa = scoreForClaimScan(a);
            const sb = scoreForClaimScan(b);
            if (sb !== sa) return sb - sa;
            return Number(b.registeredAt || "0") - Number(a.registeredAt || "0");
          })
          .slice(0, 600);

        // ✅ IMPORTANT: keep lookup map from ALL rows (claim history / participatedEver)
        const joinedRowById = new Map<string, UserLotteryItem>();
        for (const row of joinedRowsAll) joinedRowById.set(normId(row.lottery), row);

        const rpcCache = rpcCacheRef.current;

        const claimableOut: ClaimableItem[] = [];
        const joinedOut: JoinedLotteryItem[] = [];

        const MAX_JOINED_ONCHAIN = isBackground ? 80 : 200;
        const MAX_CLAIM_SCAN = isBackground ? 60 : 180;

        const candLen = Math.max(1, candidatesAll.length);
        const start = claimScanCursorRef.current % candLen;
        const endExclusive = Math.min(start + MAX_CLAIM_SCAN, candidatesAll.length);

        const scanSlice =
          candidatesAll.length <= MAX_CLAIM_SCAN
            ? candidatesAll
            : [
                ...candidatesAll.slice(start, endExclusive),
                ...candidatesAll.slice(0, Math.max(0, MAX_CLAIM_SCAN - (endExclusive - start))),
              ];

        claimScanCursorRef.current = (start + MAX_CLAIM_SCAN) % candLen;

        await mapPool(joinedBase.slice(0, MAX_JOINED_ONCHAIN), 10, async (lot) => {
          const id = normId(lot.id);
          const row = joinedRowById.get(id);

          const v = await readDashboardValues({
            lotteryId: id,
            account,
            cache: rpcCache,
            ttlMs: 20_000,
          });

          const owned = BigInt(v.owned);
          const cf = BigInt(v.cf);

          const price = BigInt(String(lot.ticketPrice ?? "0") || "0");
          const refundNow = lot.status === "CANCELED" ? owned * price : 0n;

          joinedOut.push({
            ...lot,
            id,
            userTicketsPurchased: row ? String(row.ticketsPurchased ?? "0") : "0",
            userUsdcSpent: row ? String(row.usdcSpent ?? "0") : "0",
            userFundsClaimedAmount: row ? String(row.fundsClaimedAmount ?? "0") : "0",
            userTicketRefundAmount: row ? String(row.ticketRefundAmount ?? "0") : "0",
            userTicketsOwned: owned.toString(),
            userClaimableFunds: cf.toString(),
            userRefundNow: refundNow.toString(),
          });
        });

        if (runId !== runIdRef.current) return;
        setJoined(joinedOut);

        await mapPool(scanSlice, Math.max(3, rpcConcurrencyRef.current.claimScan), async (lot) => {
          const id = normId(lot.id);
          const row = joinedRowById.get(id);

          const v = await readDashboardValues({
            lotteryId: id,
            account,
            cache: rpcCache,
            ttlMs: 20_000,
          });

          const owned = BigInt(v.owned);
          const cf = BigInt(v.cf);

          const price = BigInt(String(lot.ticketPrice ?? "0") || "0");
          const refundNow = lot.status === "CANCELED" ? owned * price : 0n;

          const participatedEver = !!row && BigInt(row.ticketsPurchased ?? "0") > 0n;

          const roles = {
            created: (lot.creator || "").toLowerCase() === myAddr,
            feeRecipient: (lot.feeRecipient || "").toLowerCase() === myAddr,
            participated: owned > 0n || participatedEver,
            winner: (lot.winner || "").toLowerCase() === myAddr,
          };

          const total = cf + refundNow;
          if (total <= 0n) return;

          let type: ClaimableItem["type"] = "OTHER";
          if (roles.winner && lot.status === "COMPLETED") type = "WIN";
          else if (lot.status === "CANCELED" && refundNow > 0n) type = "REFUND";

          const histClaimed =
            row && (BigInt(row.fundsClaimedAmount ?? "0") > 0n || BigInt(row.ticketRefundAmount ?? "0") > 0n);
          if (histClaimed && cf === 0n && refundNow === 0n && owned === 0n) return;

          claimableOut.push({
            lottery: { ...lot, id },
            claimableUsdc: cf.toString(),
            refundUsdc: refundNow.toString(),
            totalUsdc: total.toString(),
            type,
            roles,
            userTicketsOwned: owned.toString(),
          });
        });

        if (runId !== runIdRef.current) return;
        setClaimables(claimableOut);

        rpcConcurrencyRef.current = {
          claimScan: Math.min(10, rpcConcurrencyRef.current.claimScan + 1),
          fillById: Math.min(10, rpcConcurrencyRef.current.fillById + 1),
        };
      } catch (e) {
        console.error("Dashboard recompute error", e);

        if (isRateLimitError(e)) {
          rpcConcurrencyRef.current = {
            claimScan: Math.max(3, Math.floor(rpcConcurrencyRef.current.claimScan / 2)),
            fillById: Math.max(3, Math.floor(rpcConcurrencyRef.current.fillById / 2)),
          };
        }

        if (!isBackground) setMsg("Failed to load dashboard data.");
      } finally {
        if (!isBackground) setLocalPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      account,
      allLotteries,
      store.items,
      created.length,
      joined.length,
      claimables.length,
      txPending,
      getUserLotteries,
      getFeeRecipientLotteries,
    ]
  );

  useEffect(() => {
    if (!account) {
      setLocalPending(false);
      return;
    }
    void (async () => {
      await refreshLotteryStore(false, true);
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
      void refreshLotteryStore(true, true);
      void recompute(true);
    };

    const onVis = () => {
      if (document.visibilityState === "visible") {
        void refreshLotteryStore(true, true);
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
    () => [...created].sort((a, b) => Number(b.registeredAt || "0") - Number(a.registeredAt || "0")),
    [created]
  );

  const joinedSorted = useMemo(
    () => [...joined].sort((a, b) => Number(b.registeredAt || "0") - Number(a.registeredAt || "0")),
    [joined]
  );

  const claimablesSorted = useMemo(
    () =>
      claimables
        .filter((c) => !hiddenClaimables[normId(c.lottery.id)])
        .sort((a, b) => Number(b.totalUsdc) - Number(a.totalUsdc)),
    [claimables, hiddenClaimables]
  );

  function emitRevalidate() {
    try {
      if (typeof window === "undefined") return;
      window.dispatchEvent(new CustomEvent("ppopgi:revalidate"));
    } catch {}
  }

  function clearRpcCacheFor(lotteryId: string, acct: string) {
    const lid = normId(lotteryId);
    const key = `${acct.toLowerCase()}:${lid}`;
    try {
      rpcCacheRef.current.delete(key);
    } catch {}
  }

  const claim = async (lotteryId: string): Promise<boolean> => {
    if (!account) return false;
    setMsg(null);

    const lid = normId(lotteryId);
    setTxPending(true);

    try {
      const c = getContract({
        client: thirdwebClient,
        chain: ETHERLINK_CHAIN,
        address: lid,
        abi: SingleWinnerLotteryABI as any,
      });

      await sendAndConfirm(
        prepareContractCall({
          contract: c,
          method: "claim",
          params: [],
        })
      );

      clearRpcCacheFor(lid, account);
      emitRevalidate();

      let stillHasSomething = true;
      try {
        const v = await readDashboardValues({
          lotteryId: lid,
          account,
          cache: rpcCacheRef.current,
          ttlMs: 0,
        });

        const cf = BigInt(v.cf);
        const owned = BigInt(v.owned);
        stillHasSomething = cf > 0n || owned > 0n;
      } catch {
        stillHasSomething = true;
      }

      if (!stillHasSomething) {
        setHiddenClaimables((p) => ({ ...p, [lid]: true }));
      }

      setMsg("Claim successful.");

      userLotsCacheRef.current = null;
      userLotsBackoffMsRef.current = 0;

      feeLotsCacheRef.current = null;
      feeLotsBackoffMsRef.current = 0;

      await refreshLotteryStore(true, true);
      await recompute(true);
      return true;
    } catch (e) {
      console.error("Claim failed", e);
      setMsg("Transaction failed.");
      return false;
    } finally {
      setTxPending(false);
    }
  };

  const refresh = async () => {
    setMsg(null);
    setHiddenClaimables({});

    userLotsCacheRef.current = null;
    userLotsBackoffMsRef.current = 0;

    feeLotsCacheRef.current = null;
    feeLotsBackoffMsRef.current = 0;

    await refreshLotteryStore(false, true);
    await recompute(false);
  };

  const hasBootstrapped = !!store.items;
  const isColdLoading = !hasBootstrapped && (localPending || store.isLoading);
  const isRefreshing = hasBootstrapped && store.isLoading;

  return {
    data: {
      created: createdSorted,
      joined: joinedSorted,
      claimables: claimablesSorted,
      msg,
      isPending: txPending || localPending || store.isLoading,
      isColdLoading,
      isRefreshing,
      storeNote: store.note,
      storeLastUpdatedMs: store.lastUpdatedMs,
      joinedBackoffMs: userLotsBackoffMsRef.current,
    },
    actions: { claim, refresh },
    account,
  };
}