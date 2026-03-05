// src/hooks/useLotteryStore.ts

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchLotteriesFromSubgraph, type LotteryListItem, type LotteryStatus } from "../indexer/subgraph";

export type StoreState = {
  items: LotteryListItem[] | null;
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

// Polling control (optional; can be disabled by pollMs <= 0)
let timer: number | null = null;

// Fetch control
let inFlight: Promise<void> | null = null;
let aborter: AbortController | null = null;

// Backoff control
let backoffUntilMs = 0;
let backoffStep = 0;

// Each consumer requests a poll interval; we use the minimum
const requestedPolls = new Map<string, number>();

// Revalidate burst control / throttling
let lastFetchStartedMs = 0;
let pendingRefreshAfterFlight = false;
let revalidateDebounceTimer: number | null = null;

// Global throttle to avoid “focus + revalidate” piling up
let nextAllowedFetchMs = 0;

// Optimistic patch dedupe (don’t apply same patch twice)
const appliedPatchIds = new Set<string>();
let patchGcTimer: number | null = null;

/**
 * ✅ Model:
 * - Edge cache (worker) does most of the work
 * - Client does short SWR to avoid redundant fetches
 * - Only burst force-fresh AFTER a user action (force revalidate)
 */
const CLIENT_SWR_TTL_MS = 4_000;

// ✅ Your target: only ~5s “freshness burst” after action
const FORCE_FRESH_BURST_MS = 5_000;
let forceFreshUntilMs = 0;

// Revalidate throttling
const SOFT_REVALIDATE_MIN_GAP_MS = 20_000; // ignore frequent soft ticks
const HARD_REVALIDATE_MIN_GAP_MS = 1_000; // allow quick refresh after user actions

// Avoid replacing items array when nothing actually changed (prevents flicker)
let lastItemsSig = "";
function signature(items: LotteryListItem[] | null) {
  if (!items || items.length === 0) return "";
  return items
    .map(
      (r) =>
        `${String(r.id)}:${String(r.status)}:${String(r.sold)}:${String(r.ticketRevenue)}:${String(r.registeredAt)}`
    )
    .join("|");
}

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

/**
 * ✅ Polling is OPTIONAL:
 * - if the minimum requested pollMs <= 0 => polling disabled
 * - otherwise: poll in foreground with a safe min, background much slower
 */
function getPollingMode(): { enabled: boolean; pollMs: number } {
  const values = [...requestedPolls.values()];
  const minRequested = values.length > 0 ? Math.min(...values) : 0;

  if (!Number.isFinite(minRequested) || minRequested <= 0) {
    return { enabled: false, pollMs: 0 };
  }

  const fg = Math.max(12_000, Math.floor(minRequested));
  const bg = Math.max(90_000, fg);
  return { enabled: true, pollMs: isHidden() ? bg : fg };
}

function scheduleNext() {
  clearTimer();
  if (subscribers <= 0) return;

  const { enabled, pollMs } = getPollingMode();
  if (!enabled) return;

  const now = Date.now();
  const waitForBackoff = Math.max(0, backoffUntilMs - now);
  const waitForThrottle = Math.max(0, nextAllowedFetchMs - now);

  const delay = Math.max(waitForBackoff, waitForThrottle, pollMs);

  timer = window.setTimeout(() => {
    void refresh(true, false); // background cached refresh
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
  return name === "AbortError" || msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("abort");
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

  nextAllowedFetchMs = Math.max(nextAllowedFetchMs, backoffUntilMs);

  setState({
    note: rateLimited ? "Indexer rate-limited. Retrying shortly…" : "Indexer temporarily unavailable.",
    lastErrorMs: Date.now(),
  });
}

function resetBackoff() {
  backoffStep = 0;
  backoffUntilMs = 0;
}

/* -----------------------------
   Optimistic patch helpers
----------------------------- */
type OptimisticEvent =
  | {
      kind: "BUY";
      patchId?: string;
      lotteryId: string;
      deltaSold: number;
      deltaRevenue?: string | number;
      tsMs?: number;
    }
  | {
      kind: "CREATE";
      patchId?: string;
      lottery: Partial<LotteryListItem> & { id: string; name: string; creator: string };
      tsMs?: number;
    };

function normHex(v: string) {
  return String(v || "").toLowerCase();
}

function ensurePatchGc() {
  if (patchGcTimer != null) return;
  patchGcTimer = window.setInterval(() => {
    if (appliedPatchIds.size > 500) appliedPatchIds.clear();
  }, 60_000);
}

function applyOptimisticBuy(e: OptimisticEvent & { kind: "BUY" }) {
  const lid = normHex(e.lotteryId);
  const delta = Math.max(0, Math.floor(Number(e.deltaSold || 0)));
  if (!lid || delta <= 0) return;

  const items = state.items;
  if (!items || items.length === 0) return;

  const deltaRev =
    e.deltaRevenue == null
      ? 0n
      : (() => {
          try {
            return BigInt(e.deltaRevenue as any);
          } catch {
            try {
              return BigInt(String(e.deltaRevenue));
            } catch {
              return 0n;
            }
          }
        })();

  const next = items.map((r) => {
    if (normHex(r.id) !== lid) return r;

    const soldN = Number(r.sold || 0);
    const nextSold = String(Math.max(0, soldN + delta));

    let nextRev = r.ticketRevenue || "0";
    if (deltaRev > 0n) {
      try {
        nextRev = (BigInt(r.ticketRevenue || "0") + deltaRev).toString();
      } catch {}
    }

    return { ...r, sold: nextSold, ticketRevenue: nextRev };
  });

  lastItemsSig = signature(next);
  setState({ items: next });
}

function applyOptimisticCreate(e: OptimisticEvent & { kind: "CREATE" }) {
  const r = e.lottery;
  if (!r?.id || !r?.name) return;

  const id = normHex(r.id);
  const creator = normHex(r.creator || "");
  if (!id || !creator) return;

  const nowSec = String(Math.floor((e.tsMs ?? Date.now()) / 1000));

  const newItem: LotteryListItem = {
    id,

    typeId: String(r.typeId ?? "1"),
    creator,
    registeredAt: String(r.registeredAt ?? nowSec),
    registryIndex: r.registryIndex != null ? String(r.registryIndex) : null,

    deployedBy: r.deployedBy != null ? String(r.deployedBy).toLowerCase() : null,
    deployedAt: r.deployedAt != null ? String(r.deployedAt) : nowSec,
    deployedTx: r.deployedTx != null ? String(r.deployedTx).toLowerCase() : null,

    name: String(r.name ?? "New Lottery"),
    usdcToken: r.usdcToken != null ? String(r.usdcToken).toLowerCase() : null,
    feeRecipient: r.feeRecipient != null ? String(r.feeRecipient).toLowerCase() : null,
    entropy: r.entropy != null ? String(r.entropy).toLowerCase() : null,
    entropyProvider: r.entropyProvider != null ? String(r.entropyProvider).toLowerCase() : null,
    callbackGasLimit: r.callbackGasLimit != null ? String(r.callbackGasLimit) : null,
    protocolFeePercent: r.protocolFeePercent != null ? String(r.protocolFeePercent) : null,

    createdAt: r.createdAt != null ? String(r.createdAt) : nowSec,
    deadline: r.deadline != null ? String(r.deadline) : null,
    ticketPrice: r.ticketPrice != null ? String(r.ticketPrice) : null,
    winningPot: r.winningPot != null ? String(r.winningPot) : null,
    minTickets: r.minTickets != null ? String(r.minTickets) : null,
    maxTickets: r.maxTickets != null ? String(r.maxTickets) : null,
    minPurchaseAmount: r.minPurchaseAmount != null ? String(r.minPurchaseAmount) : null,

    status: (r.status as LotteryStatus) ?? "FUNDING_PENDING",
    sold: String(r.sold ?? "0"),
    ticketRevenue: String(r.ticketRevenue ?? "0"),

    winner: r.winner != null ? String(r.winner).toLowerCase() : null,
    selectedProvider: r.selectedProvider != null ? String(r.selectedProvider).toLowerCase() : null,
    entropyRequestId: r.entropyRequestId != null ? String(r.entropyRequestId) : null,
    drawingRequestedAt: r.drawingRequestedAt != null ? String(r.drawingRequestedAt) : null,
    soldAtDrawing: r.soldAtDrawing != null ? String(r.soldAtDrawing) : null,

    canceledAt: r.canceledAt != null ? String(r.canceledAt) : null,
    soldAtCancel: r.soldAtCancel != null ? String(r.soldAtCancel) : null,
    cancelReason: r.cancelReason != null ? String(r.cancelReason) : null,
    creatorPotRefunded: typeof r.creatorPotRefunded === "boolean" ? r.creatorPotRefunded : null,

    totalReservedUSDC: r.totalReservedUSDC != null ? String(r.totalReservedUSDC) : null,
  };

  const items = state.items ?? [];
  if (items.some((x) => normHex(x.id) === id)) return;

  const next = [newItem, ...items].sort((a, b) => Number(b.registeredAt || "0") - Number(a.registeredAt || "0"));

  lastItemsSig = signature(next);
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

/* -----------------------------
   Fetching
----------------------------- */

function clampFirstForContext() {
  return isHidden() ? 120 : 200;
}

function shouldForceFreshNow(force: boolean) {
  if (force) return true;
  return Date.now() < forceFreshUntilMs;
}

function canStartFetch(force: boolean) {
  if (subscribers <= 0) return { ok: false, reason: "no-subs" as const };

  const now = Date.now();

  // Client SWR unless forcing fresh
  const swrFresh = state.lastUpdatedMs > 0 && now - state.lastUpdatedMs < CLIENT_SWR_TTL_MS;
  if (!shouldForceFreshNow(force) && swrFresh) return { ok: false, reason: "swr-fresh" as const };

  if (!force && now < backoffUntilMs) return { ok: false, reason: "backoff" as const };
  if (!force && now < nextAllowedFetchMs) return { ok: false, reason: "throttle" as const };
  if (inFlight) return { ok: false, reason: "inflight" as const };

  return { ok: true, reason: "ok" as const };
}

async function doFetch(isBackground: boolean, force: boolean) {
  if (inFlight) return inFlight;

  const forceFresh = shouldForceFreshNow(force);

  inFlight = (async () => {
    if (!isBackground && state.items === null) setState({ isLoading: true });

    aborter?.abort();
    aborter = new AbortController();

    lastFetchStartedMs = Date.now();

    try {
      const data = await fetchLotteriesFromSubgraph({
        first: clampFirstForContext(),
        signal: aborter.signal,
        forceFresh,
      });

      const nextSig = signature(data);
      const prevSig = lastItemsSig;

      if (nextSig !== prevSig) {
        lastItemsSig = nextSig;
        setState({
          items: data,
          note: null,
          isLoading: false,
          lastUpdatedMs: Date.now(),
        });
      } else {
        setState({ note: null, isLoading: false });
      }

      resetBackoff();
      nextAllowedFetchMs = Date.now() + 1_500;
    } catch (err) {
      if (isAbortError(err)) {
        setState({ isLoading: false });
      } else {
        setState({ isLoading: false });
        applyBackoff(err);
        // eslint-disable-next-line no-console
        console.warn("[useLotteryStore] fetch failed", err);
      }
    } finally {
      inFlight = null;

      if (pendingRefreshAfterFlight) {
        pendingRefreshAfterFlight = false;
        requestRevalidate(true);
      } else {
        scheduleNext();
      }
    }
  })();

  return inFlight;
}

export async function refresh(isBackground = false, force = false) {
  if (subscribers <= 0) return;

  // If hidden and background, don’t fetch unless forced (user action)
  if (isBackground && isHidden() && !force) {
    scheduleNext();
    return;
  }

  if (force) {
    backoffUntilMs = 0;
    nextAllowedFetchMs = 0;
  }

  const gate = canStartFetch(force);
  if (!gate.ok) {
    if (gate.reason === "inflight") pendingRefreshAfterFlight = true;
    scheduleNext();
    return;
  }

  await doFetch(isBackground, force);
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

/* -----------------------------
   Revalidate handling
----------------------------- */

function clearRevalidateDebounce() {
  if (revalidateDebounceTimer != null) {
    window.clearTimeout(revalidateDebounceTimer);
    revalidateDebounceTimer = null;
  }
}

/**
 * ✅ Key behavior:
 * - SOFT revalidate => cached refresh (force=false)
 * - HARD revalidate (user action) => open force-fresh burst window + force refresh
 */
function requestRevalidate(force = false) {
  if (subscribers <= 0) return;

  // ✅ If hidden:
  // - ignore soft revalidates
  // - allow forced revalidates (action happened) so next foreground is fresh sooner
  if (isHidden() && !force) return;

  const now = Date.now();

  if (force) {
    forceFreshUntilMs = Math.max(forceFreshUntilMs, now + FORCE_FRESH_BURST_MS);
  }

  const minGap = force ? HARD_REVALIDATE_MIN_GAP_MS : SOFT_REVALIDATE_MIN_GAP_MS;

  if (inFlight) {
    pendingRefreshAfterFlight = true;
    return;
  }

  const earliest = Math.max(lastFetchStartedMs + minGap, nextAllowedFetchMs);
  const wait = Math.max(0, earliest - now);

  if (wait > 0) {
    clearRevalidateDebounce();
    revalidateDebounceTimer = window.setTimeout(() => {
      revalidateDebounceTimer = null;
      void refresh(true, force);
    }, wait);
    return;
  }

  void refresh(true, force);
}

/* -----------------------------
   Store lifecycle
----------------------------- */

export function startLotteryStore(consumerKey: string, pollMs: number) {
  subscribers += 1;
  requestedPolls.set(consumerKey, pollMs);

  if (subscribers === 1) {
    // Focus/visible should be cached refresh, not force-fresh
    const onFocus = () => requestRevalidate(false);
    const onVis = () => {
      if (!isHidden()) requestRevalidate(false);
    };

    // Revalidate event:
    // - only user actions should send { detail: { force: true } }
    const onReval = (e: Event) => {
      const ce = e as CustomEvent<{ force?: boolean }>;
      requestRevalidate(!!ce?.detail?.force);
    };

    const onOpt = (e: Event) => {
      const ce = e as CustomEvent;
      const detail = ce?.detail;
      if (!detail || typeof detail !== "object") return;
      handleOptimisticEvent(detail as any);
      // Optimistic updates should NOT force a fetch immediately.
      // A real fetch comes from revalidate (ideally with force=true after action).
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("ppopgi:revalidate", onReval as any);
    window.addEventListener("ppopgi:optimistic", onOpt as any);

    (startLotteryStore as any)._cleanup = () => {
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

    // Initial load should be cached (worker will serve fast).
    void refresh(false, false);
  } else {
    if (!state.items) void refresh(false, false);
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
      (startLotteryStore as any)._cleanup?.();

      // reset burst window
      forceFreshUntilMs = 0;
    } else {
      scheduleNext();
    }
  };
}

export function useLotteryStore(consumerKey: string, pollMs: number) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const stop = startLotteryStore(consumerKey, pollMs);
    return () => stop();
  }, [consumerKey, pollMs]);

  return useMemo(() => snap, [snap]);
}