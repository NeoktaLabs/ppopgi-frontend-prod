// src/hooks/useRaffleStore.ts
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchRafflesFromSubgraph, type RaffleListItem } from "../indexer/subgraph";

export type StoreState = {
  items: RaffleListItem[] | null;
  isLoading: boolean;
  note: string | null;
  lastUpdatedMs: number;
  lastErrorMs: number;
};

type Listener = () => void;

let state: StoreState = {
  items: null,
  isLoading: false,
  note: null,
  lastUpdatedMs: 0,
  lastErrorMs: 0,
};

const listeners = new Set<Listener>();
let subscribers = 0;

// Polling control
let timer: number | null = null;
let inFlight: Promise<void> | null = null;
let aborter: AbortController | null = null;

// Backoff control
let backoffUntilMs = 0;
let backoffStep = 0;

// Each consumer requests a poll interval; we use the minimum
const requestedPolls = new Map<string, number>();

// ✅ Revalidate burst control
let lastFetchStartedMs = 0;
let pendingRefreshAfterFlight = false;
let revalidateDebounceTimer: number | null = null;

// ✅ Optimistic patch dedupe (don’t apply same patch twice)
const appliedPatchIds = new Set<string>();
let patchGcTimer: number | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

function shallowEqual(a: any, b: any) {
  if (Object.is(a, b)) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!Object.is(a[k], b[k])) return false;
  return true;
}

function setState(patch: Partial<StoreState>) {
  const next: StoreState = { ...state, ...patch };
  if (shallowEqual(state, next)) return;
  state = next;
  emit();
}

function isHidden() {
  try {
    return typeof document !== "undefined" && document.hidden;
  } catch {
    return false;
  }
}

function clearTimer() {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

function computePollMs() {
  const minRequested = requestedPolls.size > 0 ? Math.min(...requestedPolls.values()) : 20_000;

  // Foreground minimum is 10s (protect indexer)
  const fg = Math.max(10_000, minRequested);

  // Background minimum is 60s
  const bg = Math.max(60_000, fg);

  return isHidden() ? bg : fg;
}

function scheduleNext() {
  clearTimer();
  if (subscribers <= 0) return;

  const now = Date.now();
  const waitForBackoff = Math.max(0, backoffUntilMs - now);
  const delay = waitForBackoff > 0 ? waitForBackoff : computePollMs();

  timer = window.setTimeout(() => {
    void refresh(true);
  }, delay);
}

function parseHttpStatus(err: any): number | null {
  const msg = String(err?.message || err || "");
  const m = msg.match(/SUBGRAPH_HTTP_ERROR_(\d{3})/);
  return m ? Number(m[1]) : null;
}

function isAbortError(err: any) {
  const name = String(err?.name ?? "");
  const msg = String(err?.message ?? err ?? "");
  return name === "AbortError" || msg.toLowerCase().includes("aborted");
}

function isRateLimitError(err: any) {
  const status = parseHttpStatus(err);
  if (status === 429 || status === 503) return true;

  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return msg.includes("too many requests") || msg.includes("rate limit") || msg.includes("429");
}

function applyBackoff(err: any) {
  if (isAbortError(err)) return;

  const rateLimited = isRateLimitError(err);
  backoffStep = Math.min(backoffStep + 1, rateLimited ? 6 : 3);

  const base = rateLimited ? 10_000 : 5_000;
  const max = rateLimited ? 5 * 60_000 : 60_000;

  const delay = Math.min(max, base * Math.pow(2, backoffStep));
  backoffUntilMs = Date.now() + delay;

  setState({
    note: rateLimited ? "Indexer rate-limited. Retrying shortly…" : "Indexer temporarily unavailable.",
    lastErrorMs: Date.now(),
  });
}

function resetBackoff() {
  backoffStep = 0;
  backoffUntilMs = 0;
}

// -----------------------------
// ✅ Optimistic patch helpers
// -----------------------------
type OptimisticEvent =
  | {
      kind: "BUY";
      patchId?: string;
      raffleId: string;
      deltaSold: number;
      tsMs?: number;
    }
  | {
      kind: "CREATE";
      patchId?: string;
      raffle: Partial<RaffleListItem> & { id: string; name: string; creator: string };
      tsMs?: number;
    };

function normHex(v: string) {
  return String(v || "").toLowerCase();
}

function ensurePatchGc() {
  if (patchGcTimer != null) return;
  patchGcTimer = window.setInterval(() => {
    // Cheap “GC”: just cap set size
    if (appliedPatchIds.size > 500) {
      appliedPatchIds.clear();
    }
  }, 60_000);
}

function applyOptimisticBuy(e: OptimisticEvent & { kind: "BUY" }) {
  const rid = normHex(e.raffleId);
  const delta = Math.max(0, Math.floor(Number(e.deltaSold || 0)));
  if (!rid || delta <= 0) return;

  const items = state.items;
  if (!items || items.length === 0) return;

  const next = items.map((r) => {
    if (normHex(r.id) !== rid) return r;

    const soldN = Number((r as any).sold || 0);
    const nextSold = String(Math.max(0, soldN + delta));

    // bump lastUpdatedTimestamp so it floats up (your query sorts by lastUpdatedTimestamp desc)
    const nowSec = Math.floor(Date.now() / 1000);
    const bumpedTs = String(Math.max(nowSec, Number((r as any).lastUpdatedTimestamp || 0)));

    return {
      ...r,
      sold: nextSold,
      lastUpdatedTimestamp: bumpedTs,
    } as any;
  });

  // Optional: re-sort by lastUpdatedTimestamp desc to keep UI consistent
  next.sort((a: any, b: any) => Number(b.lastUpdatedTimestamp || 0) - Number(a.lastUpdatedTimestamp || 0));

  setState({ items: next });
}

function applyOptimisticCreate(e: OptimisticEvent & { kind: "CREATE" }) {
  const r = e.raffle;
  if (!r?.id || !r?.name) return;

  const id = normHex(r.id);
  const creator = normHex(r.creator || "");
  if (!id || !creator) return;

  const nowSec = String(Math.floor(Date.now() / 1000));

  const newItem: RaffleListItem = {
    // required fields — fill best-effort defaults
    id,
    name: String(r.name),
    status: (r.status as any) ?? "FUNDING_PENDING",

    deployer: (r.deployer as any) ?? null,
    registry: (r.registry as any) ?? null,
    typeId: (r.typeId as any) ?? null,
    registryIndex: (r.registryIndex as any) ?? null,
    isRegistered: Boolean((r as any).isRegistered ?? false),
    registeredAt: (r.registeredAt as any) ?? null,

    creator,
    createdAtBlock: String((r as any).createdAtBlock ?? "0"),
    createdAtTimestamp: String((r as any).createdAtTimestamp ?? nowSec),
    creationTx: String((r as any).creationTx ?? "0x"),

    usdc: String((r as any).usdc ?? "0x"),
    entropy: String((r as any).entropy ?? "0x"),
    entropyProvider: String((r as any).entropyProvider ?? "0x"),
    feeRecipient: String((r as any).feeRecipient ?? "0x"),
    protocolFeePercent: String((r as any).protocolFeePercent ?? "0"),
    callbackGasLimit: String((r as any).callbackGasLimit ?? "0"),
    minPurchaseAmount: String((r as any).minPurchaseAmount ?? "1"),

    winningPot: String((r as any).winningPot ?? "0"),
    ticketPrice: String((r as any).ticketPrice ?? "0"),
    deadline: String((r as any).deadline ?? "0"),
    minTickets: String((r as any).minTickets ?? "1"),
    maxTickets: String((r as any).maxTickets ?? "0"),
    sold: String((r as any).sold ?? "0"),
    ticketRevenue: String((r as any).ticketRevenue ?? "0"),
    paused: Boolean((r as any).paused ?? false),

    finalizeRequestId: (r.finalizeRequestId as any) ?? null,
    finalizedAt: (r.finalizedAt as any) ?? null,
    selectedProvider: (r.selectedProvider as any) ?? null,
    winner: (r.winner as any) ?? null,
    winningTicketIndex: (r.winningTicketIndex as any) ?? null,
    completedAt: (r.completedAt as any) ?? null,
    canceledReason: (r.canceledReason as any) ?? null,
    canceledAt: (r.canceledAt as any) ?? null,
    soldAtCancel: (r.soldAtCancel as any) ?? null,

    lastUpdatedBlock: String((r as any).lastUpdatedBlock ?? "0"),
    lastUpdatedTimestamp: String((r as any).lastUpdatedTimestamp ?? nowSec),
  };

  const items = state.items ?? [];
  const exists = items.some((x) => normHex(x.id) === id);
  if (exists) return;

  const next = [newItem, ...items];
  // keep it consistent with your list ordering
  next.sort((a: any, b: any) => Number(b.lastUpdatedTimestamp || 0) - Number(a.lastUpdatedTimestamp || 0));

  setState({ items: next });
}

function handleOptimisticEvent(ev: OptimisticEvent) {
  ensurePatchGc();

  const patchId = String((ev as any).patchId || "");
  if (patchId) {
    if (appliedPatchIds.has(patchId)) return;
    appliedPatchIds.add(patchId);
  }

  if (ev.kind === "BUY") applyOptimisticBuy(ev);
  if (ev.kind === "CREATE") applyOptimisticCreate(ev);
}

// -----------------------------
// Fetching
// -----------------------------
async function doFetch(isBackground: boolean) {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    if (!isBackground) setState({ isLoading: true });

    aborter?.abort();
    aborter = new AbortController();

    lastFetchStartedMs = Date.now();

    try {
      const data = await fetchRafflesFromSubgraph({
        first: 1000,
        signal: aborter.signal,
      });

      setState({
        items: data,
        note: null,
        isLoading: false,
        lastUpdatedMs: Date.now(),
      });

      resetBackoff();
    } catch (err) {
      if (isAbortError(err)) {
        if (!isBackground) setState({ isLoading: false });
      } else {
        if (!isBackground) setState({ isLoading: false });
        applyBackoff(err);
        // eslint-disable-next-line no-console
        console.warn("[useRaffleStore] fetch failed", err);
      }
    } finally {
      inFlight = null;

      // ✅ if something requested refresh during flight, do one more (once)
      if (pendingRefreshAfterFlight) {
        pendingRefreshAfterFlight = false;
        // background refresh, but forced
        void refresh(true, true);
      } else {
        scheduleNext();
      }
    }
  })();

  return inFlight;
}

export async function refresh(isBackground = false, force = false) {
  if (subscribers <= 0) return;

  if (!force && Date.now() < backoffUntilMs) {
    scheduleNext();
    return;
  }

  if (force) backoffUntilMs = 0;

  await doFetch(isBackground);
}

export function getSnapshot(): StoreState {
  return state;
}

function getServerSnapshot(): StoreState {
  return state;
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// -----------------------------
// Store lifecycle
// -----------------------------
function clearRevalidateDebounce() {
  if (revalidateDebounceTimer != null) {
    window.clearTimeout(revalidateDebounceTimer);
    revalidateDebounceTimer = null;
  }
}

/**
 * When UI emits "ppopgi:revalidate", we:
 * - don’t spam (min gap)
 * - don’t overlap (if inFlight => queue one refresh)
 */
function requestRevalidate(force = false) {
  if (subscribers <= 0) return;

  // if hidden, don’t thrash — let normal background polling handle it
  if (isHidden()) return;

  const now = Date.now();
  const minGap = 2500;

  // already fetching => queue one refresh after it finishes
  if (inFlight) {
    pendingRefreshAfterFlight = true;
    return;
  }

  // burst dedupe (double ping from buy etc.)
  const since = now - lastFetchStartedMs;
  if (!force && since >= 0 && since < minGap) {
    clearRevalidateDebounce();
    revalidateDebounceTimer = window.setTimeout(() => {
      void refresh(true, true);
    }, minGap - since);
    return;
  }

  void refresh(true, true);
}

export function startRaffleStore(consumerKey: string, pollMs: number) {
  subscribers += 1;
  requestedPolls.set(consumerKey, pollMs);

  if (subscribers === 1) {
    const onFocus = () => requestRevalidate(true);
    const onVis = () => {
      if (!isHidden()) requestRevalidate(true);
    };

    // ✅ app-wide revalidate event
    const onReval = () => requestRevalidate(false);

    // ✅ optimistic event
    const onOpt = (e: Event) => {
      const ce = e as CustomEvent;
      const detail = ce?.detail;
      if (!detail || typeof detail !== "object") return;
      handleOptimisticEvent(detail as any);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("ppopgi:revalidate", onReval as any);
    window.addEventListener("ppopgi:optimistic", onOpt as any);

    (startRaffleStore as any)._cleanup = () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("ppopgi:revalidate", onReval as any);
      window.removeEventListener("ppopgi:optimistic", onOpt as any);
      clearRevalidateDebounce();
      if (patchGcTimer != null) {
        window.clearInterval(patchGcTimer);
        patchGcTimer = null;
      }
    };

    // initial fetch
    void refresh(false, true);
  } else {
    if (!state.items) void refresh(false, true);
    scheduleNext();
  }

  return () => {
    subscribers = Math.max(0, subscribers - 1);
    requestedPolls.delete(consumerKey);

    if (subscribers <= 0) {
      clearTimer();
      aborter?.abort();
      aborter = null;
      inFlight = null;
      pendingRefreshAfterFlight = false;
      clearRevalidateDebounce();
      (startRaffleStore as any)._cleanup?.();
    } else {
      scheduleNext();
    }
  };
}

export function useRaffleStore(consumerKey: string, pollMs: number) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const stop = startRaffleStore(consumerKey, pollMs);
    return () => stop();
  }, [consumerKey, pollMs]);

  return useMemo(() => snap, [snap]);
}