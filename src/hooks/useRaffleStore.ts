// src/hooks/useRaffleStore.ts
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchRafflesFromSubgraph, type RaffleListItem } from "../indexer/subgraph";

/**
 * Shared raffle store
 * - Single indexer poller for the whole app
 * - Dedupes requests
 * - Backs off on 429 / rate limits
 * - Slows down when tab is hidden
 * - Stops polling when unused
 *
 * Exports:
 *  1) Store functions: startRaffleStore/refresh/getSnapshot/subscribe
 *  2) React hook: useRaffleStore(consumerKey, pollMs)
 */

export type StoreState = {
  items: RaffleListItem[] | null;
  isLoading: boolean;
  note: string | null;
  lastUpdatedMs: number;
  lastErrorMs: number;
};

type Listener = () => void;

// IMPORTANT: snapshot must be referentially stable.
// We keep `state` as an immutable object reference and replace it on changes.
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
  // Avoid emitting if nothing actually changed (prevents extra renders)
  if (shallowEqual(state, next)) return;
  state = next; // ✅ replace reference
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
  const minRequested =
    requestedPolls.size > 0 ? Math.min(...requestedPolls.values()) : 20_000;

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
  // Don’t backoff on aborts (normal during navigation/unmount)
  if (isAbortError(err)) return;

  const rateLimited = isRateLimitError(err);

  // steps: grow faster when rate-limited, slower otherwise
  backoffStep = Math.min(backoffStep + 1, rateLimited ? 6 : 3);

  const base = rateLimited ? 10_000 : 5_000;
  const max = rateLimited ? 5 * 60_000 : 60_000;

  const delay = Math.min(max, base * Math.pow(2, backoffStep));
  backoffUntilMs = Date.now() + delay;

  setState({
    note: rateLimited
      ? "Indexer rate-limited. Retrying shortly…"
      : "Indexer temporarily unavailable.",
    lastErrorMs: Date.now(),
  });
}

function resetBackoff() {
  backoffStep = 0;
  backoffUntilMs = 0;
}

async function doFetch(isBackground: boolean) {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    if (!isBackground) setState({ isLoading: true });

    // cancel any previous request
    aborter?.abort();
    aborter = new AbortController();

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
      // If aborted, treat as neutral (no error UI/backoff)
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
      scheduleNext();
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

// ✅ CRITICAL: return the SAME reference until state changes
export function getSnapshot(): StoreState {
  return state;
}

// for SSR / fallback (same shape, stable)
function getServerSnapshot(): StoreState {
  return state;
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startRaffleStore(consumerKey: string, pollMs: number) {
  subscribers += 1;
  requestedPolls.set(consumerKey, pollMs);

  // Attach lifecycle listeners once
  if (subscribers === 1) {
    const onFocus = () => refresh(true, true);
    const onVis = () => {
      if (!isHidden()) refresh(true, true);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    (startRaffleStore as any)._cleanup = () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };

    // initial fetch
    void refresh(false, true);
  } else {
    // if we already have data, don’t force; otherwise, fetch once
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
      (startRaffleStore as any)._cleanup?.();
    } else {
      scheduleNext();
    }
  };
}

/**
 * React Hook wrapper around the store.
 * - starts store on mount
 * - stops store on unmount
 * - returns current snapshot
 */
export function useRaffleStore(consumerKey: string, pollMs: number) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const stop = startRaffleStore(consumerKey, pollMs);
    return () => stop();
  }, [consumerKey, pollMs]);

  return useMemo(() => snap, [snap]);
}