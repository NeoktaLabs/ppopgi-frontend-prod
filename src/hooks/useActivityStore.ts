// src/hooks/useActivityStore.ts
import { useEffect, useMemo, useState } from "react";
import { fetchGlobalActivity, type GlobalActivityItem } from "../indexer/subgraph";
import { refresh as refreshLotteryStore } from "./useLotteryStore";

type LocalActivityItem = GlobalActivityItem & {
  pending?: boolean;
  pendingLabel?: string;
};

const MAX_ITEMS = 10;

// Safety poll only (store does NOT do fast polling itself)
const SAFETY_POLL_MS = 60_000;

/**
 * ✅ Burst schedule after a user action.
 * We retry a few times inside the 5s window to catch indexer lag quickly
 * without hammering long-term.
 */
const FORCE_FRESH_BURST_MS = [0, 1500, 3000, 4500];

// Backoff when rate-limited
const RATE_LIMIT_BACKOFF_MS = [10_000, 15_000, 30_000, 60_000, 120_000, 120_000];

function isHidden() {
  try {
    return typeof document !== "undefined" && document.hidden;
  } catch {
    return false;
  }
}

function parseHttpStatus(err: unknown): number | null {
  const msg = String((err as any)?.message || err || "");
  const m = msg.match(/SUBGRAPH_HTTP_ERROR_(\d{3})/);
  return m ? Number(m[1]) : null;
}

function isAbortError(err: unknown) {
  const name = String((err as any)?.name ?? "");
  const msg = String((err as any)?.message ?? err ?? "");
  return name === "AbortError" || msg.toLowerCase().includes("abort");
}

function isRateLimitError(err: unknown) {
  const status = parseHttpStatus(err);
  if (status === 429 || status === 503) return true;

  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  return msg.includes("429") || msg.includes("too many requests") || msg.includes("rate limit");
}

// ---------- module-level singleton store ----------
type State = {
  items: LocalActivityItem[];
  isLoading: boolean;
  note: string | null;
  lastUpdatedMs: number;
};

let state: State = {
  items: [],
  isLoading: true,
  note: null,
  lastUpdatedMs: 0,
};

let timer: number | null = null;
let inFlight = false;
let backoffStep = 0;
let abortRef: AbortController | null = null;
let started = false;

const subs = new Set<() => void>();

function emit() {
  state = { ...state, lastUpdatedMs: Date.now() };
  subs.forEach((fn) => fn());
}

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  emit();
}

function clearTimer() {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

function schedule(ms: number, forceFresh: boolean) {
  clearTimer();
  timer = window.setTimeout(() => void load(true, forceFresh), ms);
}

/**
 * ✅ Revalidate dispatcher:
 * - soft: derived UI recompute, cached store refresh
 * - forced: user action -> burst force-fresh in other stores
 */
function dispatchRevalidateThrottledFactory() {
  let lastAt = 0;
  return (force = false) => {
    const now = Date.now();
    if (now - lastAt < 1_000) return;
    lastAt = now;
    try {
      window.dispatchEvent(new CustomEvent("ppopgi:revalidate", { detail: { force } }));
    } catch {}
  };
}
const dispatchRevalidate = dispatchRevalidateThrottledFactory();

// ✅ Force-fresh window ONLY after user actions (burst)
let forceFreshUntilMs = 0;

// ✅ Your target: 5s burst window
const FORCE_FRESH_WINDOW_MS = 5_000;

function enterForceFreshWindow(ms = FORCE_FRESH_WINDOW_MS) {
  forceFreshUntilMs = Math.max(forceFreshUntilMs, Date.now() + ms);
}
function inForceFreshWindow() {
  return Date.now() < forceFreshUntilMs;
}

async function load(isBackground: boolean, forceFresh = false) {
  const effectiveForceFresh = forceFresh || inForceFreshWindow();

  // Background tab protection (unless it was a forced call, which still gets blocked here
  // to avoid invisible hammering; it will catch up on focus/visible + next burst tick)
  if (isBackground && isHidden()) {
    schedule(SAFETY_POLL_MS, false);
    return;
  }

  if (inFlight) return;
  inFlight = true;

  try {
    abortRef?.abort();
  } catch {}
  const ac = new AbortController();
  abortRef = ac;

  try {
    // Only show spinner if we truly have nothing
    if (state.items.length === 0) setState({ isLoading: true });

    const data = await fetchGlobalActivity({
      first: MAX_ITEMS,
      signal: ac.signal,
      forceFresh: effectiveForceFresh,
    });

    if (ac.signal.aborted) return;

    const real = (data ?? []) as LocalActivityItem[];

    // detect "new real item" to poke other stores (soft)
    const prevRealHashes = new Set(state.items.filter((x) => !x.pending).map((x) => x.txHash));
    const nextRealHashes = new Set(real.map((x) => x.txHash));

    let hasNew = false;
    for (const h of nextRealHashes) {
      if (h && !prevRealHashes.has(h)) {
        hasNew = true;
        break;
      }
    }

    // merge: keep pending items that haven't appeared as real yet
    const pending = state.items.filter((x) => x.pending);
    const realHashes = new Set(real.map((x) => x.txHash));
    const stillPending = pending.filter((p) => !realHashes.has(p.txHash));

    setState({
      items: [...stillPending, ...real].slice(0, MAX_ITEMS),
      isLoading: false,
      note: null,
    });

    backoffStep = 0;
    schedule(SAFETY_POLL_MS, false);

    if (hasNew) {
      // ✅ NOT a user action. Indexer just caught up -> soft refresh only.
      dispatchRevalidate(false);
      void refreshLotteryStore(true, false);
    }
  } catch (e: any) {
    if (isAbortError(e)) return;

    console.error("[useActivityStore] load failed", e);

    const rateLimited = isRateLimitError(e);
    setState({
      isLoading: false,
      note: rateLimited ? "Activity feed rate-limited. Retrying shortly…" : "Activity feed temporarily unavailable.",
    });

    if (rateLimited) {
      backoffStep = Math.min(backoffStep + 1, RATE_LIMIT_BACKOFF_MS.length - 1);
      schedule(RATE_LIMIT_BACKOFF_MS[backoffStep], false);
    } else {
      schedule(isBackground ? 15_000 : 10_000, false);
    }
  } finally {
    inFlight = false;
  }
}

/**
 * ✅ Burst only after a user action (optimistic event).
 * This allows activity to become "real" quickly without permanent hammering.
 */
function triggerForceFreshBurst() {
  enterForceFreshWindow(FORCE_FRESH_WINDOW_MS);
  for (const ms of FORCE_FRESH_BURST_MS) {
    window.setTimeout(() => void load(true, true), ms);
  }
}

function start() {
  if (started) return;
  started = true;

  void load(false, false);

  const onOptimistic = (ev: Event) => {
    const d = (ev as CustomEvent).detail as Partial<LocalActivityItem> | null;
    if (!d?.txHash) return;

    const now = Math.floor(Date.now() / 1000);

    const item: LocalActivityItem = {
      type: (d.type as any) ?? "BUY",
      lotteryId: String(d.lotteryId ?? ""),
      lotteryName: String(d.lotteryName ?? "Pending..."),
      subject: String(d.subject ?? "0x"),
      value: String(d.value ?? "0"),
      timestamp: String(d.timestamp ?? now),
      txHash: String(d.txHash),
      pending: true,
      pendingLabel: d.pendingLabel ? String(d.pendingLabel) : "Indexing…",
    };

    setState({
      items: [item, ...state.items.filter((x) => x.txHash !== item.txHash)].slice(0, MAX_ITEMS),
    });

    // ✅ This IS a user action -> forced revalidate + force-fresh burst
    dispatchRevalidate(true);
    void refreshLotteryStore(true, true);
    triggerForceFreshBurst();
  };

  window.addEventListener("ppopgi:activity", onOptimistic as any);

  /**
   * ✅ Revalidate listener:
   * - If {force:true} (user action), do ONE force-fresh load (+ 5s window)
   * - Otherwise (soft tick), do cached load (no force)
   */
  const onRevalidate = (e: Event) => {
    const ce = e as CustomEvent<{ force?: boolean }>;
    const forced = !!ce?.detail?.force;

    if (forced) {
      enterForceFreshWindow(FORCE_FRESH_WINDOW_MS);
      void load(true, true);
      return;
    }

    void load(true, false);
  };
  window.addEventListener("ppopgi:revalidate", onRevalidate as any);

  const onFocus = () => void load(true, false);
  const onVis = () => {
    if (!isHidden()) void load(true, false);
  };

  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVis);

  // NOTE: singleton lifetime; no cleanup needed.
}

export function useActivityStore() {
  const [, force] = useState(0);

  useEffect(() => {
    start();
    const sub = () => force((x) => x + 1);
    subs.add(sub);

    return () => {
      subs.delete(sub);
    };
  }, []);

  return useMemo(
    () => ({
      items: state.items,
      isLoading: state.isLoading,
      note: state.note,
      lastUpdatedMs: state.lastUpdatedMs,
      refresh: () => void load(false, false),
      refreshForceFresh: () => void load(false, true),
    }),
    [state.lastUpdatedMs]
  );
}

// Imperative refresh helpers (optional)
export function refresh(background = true, forceFresh = false) {
  start();
  return load(background, forceFresh);
}

export function refreshForceFresh(background = true) {
  start();
  return load(background, true);
}