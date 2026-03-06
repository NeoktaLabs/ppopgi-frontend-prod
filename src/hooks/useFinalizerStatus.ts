// src/hooks/useFinalizerStatus.ts
import { useSyncExternalStore } from "react";

type FinalizerLevel = "healthy" | "degraded" | "down" | "unknown";

export type FinalizerStatus = {
  tsMs: number;

  running: boolean;
  level: FinalizerLevel;
  label: string;

  lastRunMs: number | null;
  nextRunMs: number | null;
  finalizerEverySec: number;

  // raw wire values
  secondsSinceLastRunWire: number | null;
  secondsToNextRunWire: number | null;

  // live values (locally computed every second)
  secondsSinceLastRun: number | null;
  secondsToNextRun: number | null;

  lastError?: string | null;
  error?: string;

  isLoading: boolean;

  pollMs: number;
  nextPollMs: number;
  secondsToNextPoll: number;
};

/* -------------------- env helpers -------------------- */

function env(name: string): string | null {
  const v = (import.meta as any).env?.[name];
  return v ? String(v) : null;
}

/* -------------------- small utils -------------------- */

function clampSec(n: any): number | null {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.floor(x));
}

function isHidden() {
  try {
    return typeof document !== "undefined" && document.hidden;
  } catch {
    return false;
  }
}

function jitterMs(baseMs: number, pct = 0.1, minMs = 2_000): number {
  const p = Math.max(0, Math.min(0.5, pct));
  const delta = baseMs * p;
  const out = Math.floor(baseMs + (Math.random() * 2 - 1) * delta);
  return Math.max(minMs, out);
}

/* -------------------- status mapping -------------------- */

function statusFromWire(w: any): { level: FinalizerLevel; label: string } {
  const status = String(w?.status || "").toLowerCase();
  const running = !!w?.running;

  if (running) return { level: "degraded", label: "Running" };
  if (status === "ok") return { level: "healthy", label: "Healthy" };
  if (status === "error") return { level: "down", label: "Error" };
  if (status.startsWith("skipped")) return { level: "degraded", label: "Skipped" };
  if (status === "running") return { level: "degraded", label: "Running" };
  if (!status) return { level: "unknown", label: "Unknown" };
  return { level: "unknown", label: "Unknown" };
}

/* -------------------- network helpers -------------------- */

async function withTimeout<T>(p: Promise<T>, ms: number, label = "timeout"): Promise<T> {
  let t: any;
  const timeout = new Promise<T>((_, rej) => {
    t = setTimeout(() => rej(new Error(label)), ms);
  });

  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t);
  }
}

async function fetchBotStatus(statusUrl: string, timeoutMs: number) {
  const res = await withTimeout(fetch(statusUrl, { cache: "no-store" }), timeoutMs, "bot_timeout");
  if (!res.ok) throw new Error(`bot_http_${res.status}`);
  const json = await res.json().catch(() => null);
  if (!json) throw new Error("bot_bad_json");
  return json;
}

/* -------------------- config -------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();

let started = false;
let subscriberCount = 0;

let pollTimer: number | null = null;
let secondTickTimer: number | null = null;
let fastPollTimer: number | null = null;

let fetching = false;
let lastFetchAtMs = 0;
let lastFocusRefreshAtMs = 0;

const FOCUS_COOLDOWN_MS = 10_000;
const MIN_FETCH_GAP_MS = 2_000;

// ✅ requested behavior
const BASE_POLL_MS = 60_000;
const FAST_POLL_MS = 5_000;

// local fallback schedule only
const finalizerEverySec = (() => {
  const v = env("VITE_FINALIZER_EVERY_SEC");
  const n = v ? Number(v) : 120;
  return Number.isFinite(n) ? Math.max(10, Math.floor(n)) : 120;
})();

const botUrl = env("VITE_FINALIZER_STATUS_URL")?.trim() || null;

/* -------------------- snapshot -------------------- */

function mkInitial(): FinalizerStatus {
  const now = Date.now();
  return {
    tsMs: now,

    running: false,
    level: "unknown",
    label: "Unknown",

    lastRunMs: null,
    nextRunMs: null,
    finalizerEverySec,

    secondsSinceLastRunWire: null,
    secondsToNextRunWire: null,

    secondsSinceLastRun: null,
    secondsToNextRun: null,

    lastError: null,
    error: undefined,

    isLoading: true,

    pollMs: BASE_POLL_MS,
    nextPollMs: now + BASE_POLL_MS,
    secondsToNextPoll: Math.floor(BASE_POLL_MS / 1000),
  };
}

let snapshot: FinalizerStatus = mkInitial();

function emit() {
  for (const l of listeners) l();
}

function setSnapshot(next: FinalizerStatus) {
  snapshot = next;
  emit();
}

function patchSnapshot(patch: (prev: FinalizerStatus) => FinalizerStatus) {
  const next = patch(snapshot);
  if (next === snapshot) return;
  setSnapshot(next);
}

/* -------------------- polling mode -------------------- */

function shouldFastPoll(s: FinalizerStatus) {
  return !!s.running || s.secondsToNextRun === 0;
}

function stopFastPolling() {
  if (fastPollTimer != null) {
    window.clearInterval(fastPollTimer);
    fastPollTimer = null;
  }
}

function ensureFastPolling() {
  if (!botUrl) return;
  if (isHidden()) return;
  if (fastPollTimer != null) return;

  fastPollTimer = window.setInterval(() => {
    void runOnce();
  }, FAST_POLL_MS);
}

function syncFastPolling() {
  if (shouldFastPoll(snapshot)) ensureFastPolling();
  else stopFastPolling();
}

/* -------------------- fetch -------------------- */

async function runOnce() {
  if (!botUrl) return;
  if (isHidden()) return;
  if (fetching) return;

  const now0 = Date.now();
  if (now0 - lastFetchAtMs < MIN_FETCH_GAP_MS) return;

  fetching = true;

  const fetchedAtMs = Date.now();
  const nextBasePollAt = fetchedAtMs + BASE_POLL_MS;

  try {
    const w = await fetchBotStatus(botUrl, 5_000);

    const mapped = statusFromWire(w);
    const running = !!w?.running;
    const lastRunMs = typeof w?.lastRun === "number" ? w.lastRun : null;

    const sinceWire = clampSec(w?.secondsSinceLastRun);
    const toWire = clampSec(w?.secondsToNextRun);
    const lastError = w?.lastError ? String(w.lastError) : null;

    // Prefer locally derived nextRun from lastRun + configured cadence.
    // Fallback to backend nextRun if lastRun is missing.
    let nextRunMs: number | null = null;
    if (lastRunMs !== null) nextRunMs = lastRunMs + finalizerEverySec * 1000;
    else nextRunMs = typeof w?.nextRun === "number" ? w.nextRun : null;

    const now = Date.now();
    const liveSince = lastRunMs !== null ? Math.max(0, Math.floor((now - lastRunMs) / 1000)) : sinceWire;
    const liveTo = nextRunMs !== null ? Math.max(0, Math.floor((nextRunMs - now) / 1000)) : toWire;

    lastFetchAtMs = now;

    const nextSnapshot: FinalizerStatus = {
      tsMs: fetchedAtMs,

      running,
      level: mapped.level,
      label: mapped.label,

      lastRunMs,
      nextRunMs,
      finalizerEverySec,

      secondsSinceLastRunWire: sinceWire,
      secondsToNextRunWire: toWire,

      secondsSinceLastRun: liveSince ?? null,
      secondsToNextRun: liveTo ?? null,

      lastError,
      error: undefined,

      isLoading: false,

      // keep the displayed base cadence as 60s; aggressive mode is internal
      pollMs: BASE_POLL_MS,
      nextPollMs: nextBasePollAt,
      secondsToNextPoll: Math.max(0, Math.floor((nextBasePollAt - now) / 1000)),
    };

    setSnapshot(nextSnapshot);

    // ✅ Stop aggressive polling only when backend truth says:
    // not running AND secondsToNextRun is positive
    if (!running && (toWire ?? liveTo ?? null) !== null && (toWire ?? liveTo ?? 0) > 0) {
      stopFastPolling();
    } else {
      syncFastPolling();
    }
  } catch (e: any) {
    lastFetchAtMs = Date.now();

    patchSnapshot((prev) => ({
      ...prev,
      tsMs: fetchedAtMs,
      level: prev.running ? prev.level : "unknown",
      label: prev.running ? prev.label : "Unknown",
      error: String(e?.message || e || "bot_error"),
      isLoading: false,
      pollMs: BASE_POLL_MS,
      nextPollMs: nextBasePollAt,
      secondsToNextPoll: Math.max(0, Math.floor((nextBasePollAt - Date.now()) / 1000)),
    }));

    // ✅ If near execution, keep aggressive polling even on transient errors
    if (shouldFastPoll(snapshot)) ensureFastPolling();
  } finally {
    fetching = false;
  }
}

/* -------------------- local clock -------------------- */

function tickEverySecond() {
  const now = Date.now();

  patchSnapshot((prev) => {
    const nextPollMs = prev.nextPollMs || now + prev.pollMs;
    const secondsToNextPoll = Math.max(0, Math.floor((nextPollMs - now) / 1000));

    const lastRunMs = prev.lastRunMs;
    const nextRunMs = prev.nextRunMs;

    const secondsSinceLastRun =
      lastRunMs !== null ? Math.max(0, Math.floor((now - lastRunMs) / 1000)) : prev.secondsSinceLastRunWire;

    const secondsToNextRun =
      nextRunMs !== null ? Math.max(0, Math.floor((nextRunMs - now) / 1000)) : prev.secondsToNextRunWire;

    const changed =
      secondsToNextPoll !== prev.secondsToNextPoll ||
      secondsSinceLastRun !== prev.secondsSinceLastRun ||
      secondsToNextRun !== prev.secondsToNextRun;

    if (!changed) return prev;

    return {
      ...prev,
      secondsToNextPoll,
      secondsSinceLastRun: secondsSinceLastRun ?? null,
      secondsToNextRun: secondsToNextRun ?? null,
    };
  });

  // ✅ enter aggressive mode locally when countdown reaches 0
  syncFastPolling();
}

/* -------------------- lifecycle -------------------- */

function scheduleBaseLoop() {
  if (pollTimer != null) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  const loop = () => {
    void runOnce();
    pollTimer = window.setTimeout(loop, jitterMs(BASE_POLL_MS, 0.1, 5_000));
  };

  pollTimer = window.setTimeout(loop, jitterMs(BASE_POLL_MS, 0.1, 5_000));
}

function onFocusOrVisible() {
  const now = Date.now();
  if (now - lastFocusRefreshAtMs < FOCUS_COOLDOWN_MS) return;
  lastFocusRefreshAtMs = now;
  void runOnce();
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    onFocusOrVisible();
  }
}

function startIfNeeded() {
  if (started) return;
  started = true;

  // ✅ requested: poll immediately on mount
  void runOnce();

  // ✅ keep a 60s background resync
  scheduleBaseLoop();

  // ✅ local 1s countdown
  secondTickTimer = window.setInterval(tickEverySecond, 1000);

  window.addEventListener("focus", onFocusOrVisible);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function stopIfPossible() {
  if (subscriberCount > 0) return;

  started = false;

  if (pollTimer != null) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  if (secondTickTimer != null) {
    window.clearInterval(secondTickTimer);
    secondTickTimer = null;
  }

  stopFastPolling();

  window.removeEventListener("focus", onFocusOrVisible);
  document.removeEventListener("visibilitychange", onVisibilityChange);

  lastFocusRefreshAtMs = 0;
}

/* -------------------- external store API -------------------- */

function subscribe(listener: Listener) {
  listeners.add(listener);
  subscriberCount += 1;

  startIfNeeded();

  return () => {
    listeners.delete(listener);
    subscriberCount = Math.max(0, subscriberCount - 1);
    stopIfPossible();
  };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return snapshot;
}

/* -------------------- public hook -------------------- */

export function useFinalizerStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}