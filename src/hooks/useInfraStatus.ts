// src/hooks/useInfraStatus.ts
import { useSyncExternalStore } from "react";

/**
 * Phase 2:
 * - Make infra polling a true singleton (one poll loop app-wide)
 * - Add smart bot-only “poke” handling + focus/visibility revalidate
 * - Keep UI “alive” with locally computed countdowns (1s tick) without duplicating network calls
 */

type IndexerLevel = "healthy" | "degraded" | "late" | "down";
type RpcLevel = "healthy" | "degraded" | "slow" | "down";
type BotLevel = "healthy" | "degraded" | "down" | "unknown";

type InfraStatus = {
  tsMs: number;

  indexer: {
    level: IndexerLevel;
    label: string;
    blocksBehind: number | null;
    headBlock: number | null;
    indexedBlock: number | null;
    error?: string;
  };

  rpc: {
    level: RpcLevel;
    label: string;
    latencyMs: number | null;
    ok: boolean;
    error?: string;
  };

  bot: {
    level: BotLevel;
    label: string;
    running: boolean;
    lastRunMs: number | null;

    /**
     * Derived schedule (UI truth):
     * nextRunMs = lastRunMs + finalizerEverySec*1000
     */
    nextRunMs: number | null;
    finalizerEverySec: number;

    // raw wire values (debug / fallback)
    secondsSinceLastRunWire: number | null;
    secondsToNextRunWire: number | null;

    // live values (computed locally every second)
    secondsSinceLastRun: number | null;
    secondsToNextRun: number | null;

    lastError?: string | null;
    error?: string;
  };

  overall: {
    level: "healthy" | "degraded" | "late" | "down";
    label: string;
  };

  pollMs: number;
  nextPollMs: number;
  secondsToNextPoll: number;

  isLoading: boolean;
};

/* -------------------- env helpers -------------------- */

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}
function env(name: string): string | null {
  const v = (import.meta as any).env?.[name];
  return v ? String(v) : null;
}

/* -------------------- small utils -------------------- */

function clampInt(n: any): number | null {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.floor(x));
}
function clampSec(n: any): number | null {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.floor(x));
}
function median(nums: number[]): number {
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function isHidden() {
  try {
    return typeof document !== "undefined" && document.hidden;
  } catch {
    return false;
  }
}

/* -------------------- status mapping -------------------- */

function indexerStatus(blocksBehind: number | null): { level: IndexerLevel; label: string } {
  if (blocksBehind === null) return { level: "down", label: "Down" };
  if (blocksBehind < 50) return { level: "healthy", label: "Healthy" };
  if (blocksBehind <= 250) return { level: "degraded", label: "Degraded" };
  return { level: "late", label: "Late" };
}

function rpcStatus(ms: number | null, ok: boolean): { level: RpcLevel; label: string } {
  if (!ok || ms === null) return { level: "down", label: "Down" };
  if (ms < 800) return { level: "healthy", label: "Healthy" };
  if (ms < 2500) return { level: "degraded", label: "Degraded" };
  return { level: "slow", label: "Slow" };
}

function botStatusFromWire(w: any): { level: BotLevel; label: string } {
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

function worstOverall(
  indexer: IndexerLevel,
  rpc: RpcLevel,
  bot: BotLevel
): { level: InfraStatus["overall"]["level"]; label: string } {
  const rank = (x: string) => {
    switch (x) {
      case "down":
        return 4;
      case "late":
        return 3;
      case "slow":
        return 2;
      case "degraded":
        return 2;
      case "unknown":
        return 1;
      case "healthy":
      default:
        return 1;
    }
  };

  const worst = Math.max(rank(indexer), rank(rpc), rank(bot));

  if (worst >= 4) return { level: "down", label: "Issues" };
  if (indexer === "late") return { level: "late", label: "Late" };
  if (indexer === "degraded" || rpc === "degraded" || rpc === "slow" || bot === "degraded") {
    return { level: "degraded", label: "Degraded" };
  }
  return { level: "healthy", label: "Healthy" };
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

async function rpcEthBlockNumber(rpcUrl: string, timeoutMs: number): Promise<{ block: number; latencyMs: number }> {
  const t0 = performance.now();
  const res = await withTimeout(
    fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    }),
    timeoutMs,
    "rpc_timeout"
  );

  if (!res.ok) throw new Error(`rpc_http_${res.status}`);
  const json = await res.json().catch(() => null);
  const hex = json?.result;
  if (!hex || typeof hex !== "string") throw new Error("rpc_bad_result");
  const block = parseInt(hex, 16);
  if (!Number.isFinite(block)) throw new Error("rpc_bad_block");

  const latencyMs = Math.max(0, Math.round(performance.now() - t0));
  return { block, latencyMs };
}

// ✅ use Worker /meta endpoint instead of POSTing _meta through /graphql
async function subgraphIndexedBlock(subgraphUrl: string, timeoutMs: number): Promise<number> {
  const metaUrl = subgraphUrl.endsWith("/graphql") ? subgraphUrl.replace(/\/graphql$/, "/meta") : subgraphUrl;

  const res = await withTimeout(fetch(metaUrl, { method: "GET", cache: "no-store" }), timeoutMs, "subgraph_timeout");

  if (!res.ok) throw new Error(`subgraph_http_${res.status}`);
  const json = await res.json().catch(() => null);
  if (json?.errors?.length) throw new Error("subgraph_graphql_error");
  const n = json?.data?._meta?.block?.number;
  const out = clampInt(n);
  if (out === null) throw new Error("subgraph_no_meta");
  return out;
}

async function fetchBotStatus(statusUrl: string, timeoutMs: number) {
  const res = await withTimeout(fetch(statusUrl, { cache: "no-store" }), timeoutMs, "bot_timeout");
  if (!res.ok) throw new Error(`bot_http_${res.status}`);
  const json = await res.json().catch(() => null);
  if (!json) throw new Error("bot_bad_json");
  return json;
}

/* -------------------- singleton store -------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();

let started = false;
let subscriberCount = 0;

let fullPollTimer: number | null = null;
let secondTickTimer: number | null = null;

let botZeroTimer: number | null = null;
let botZeroTries = 0;
let botZeroBackoffMs = 15_000;

let fetchingFull = false;
let fetchingBot = false;

let lastPokeAtMs = 0;
const POKE_THROTTLE_MS = 15_000;

const subgraphUrl = mustEnv("VITE_SUBGRAPH_URL");
const rpcUrl = mustEnv("VITE_ETHERLINK_RPC_URL");
const botUrl = env("VITE_FINALIZER_STATUS_URL")?.trim() || null;

// Polling cadence:
// - default 30s, min 15s (Phase 2). You can override via VITE_INFRA_POLL_MS.
const pollMs = (() => {
  const v = env("VITE_INFRA_POLL_MS");
  const n = v ? Number(v) : 30_000;
  if (!Number.isFinite(n)) return 30_000;
  return Math.max(15_000, Math.floor(n));
})();

// Finalizer schedule (default 3 minutes)
const finalizerEverySec = (() => {
  const v = env("VITE_FINALIZER_EVERY_SEC");
  const n = v ? Number(v) : 180;
  return Number.isFinite(n) ? Math.max(10, Math.floor(n)) : 180;
})();

function mkInitial(): InfraStatus {
  const now = Date.now();
  return {
    tsMs: now,
    indexer: { level: "down", label: "Down", blocksBehind: null, headBlock: null, indexedBlock: null },
    rpc: { level: "down", label: "Down", latencyMs: null, ok: false },
    bot: {
      level: "unknown",
      label: "Unknown",
      running: false,
      lastRunMs: null,
      nextRunMs: null,
      finalizerEverySec,
      secondsSinceLastRunWire: null,
      secondsToNextRunWire: null,
      secondsSinceLastRun: null,
      secondsToNextRun: null,
      lastError: null,
    },
    overall: { level: "down", label: "Issues" },
    isLoading: true,
    pollMs,
    nextPollMs: now + pollMs,
    secondsToNextPoll: Math.floor(pollMs / 1000),
  };
}

let snapshot: InfraStatus = mkInitial();

function emit() {
  for (const l of listeners) l();
}

function setSnapshot(next: InfraStatus) {
  snapshot = next;
  emit();
}

function patchSnapshot(patch: (prev: InfraStatus) => InfraStatus) {
  const next = patch(snapshot);
  if (next === snapshot) return;
  setSnapshot(next);
}

/* -------------------- bot-only refresh (cheap, “alive”) -------------------- */

async function runBotOnlyOnce() {
  if (!botUrl) return;
  if (isHidden()) return;
  if (fetchingBot) return;

  fetchingBot = true;
  try {
    const w = await fetchBotStatus(botUrl, 5000);

    const bs = botStatusFromWire(w);
    const botLevel = bs.level;
    const botLabel = bs.label;
    const botRunning = !!w?.running;

    const lastRunMs = typeof w?.lastRun === "number" ? w.lastRun : null;

    const sinceWire = clampSec(w?.secondsSinceLastRun);
    const toWire = clampSec(w?.secondsToNextRun);
    const lastError = w?.lastError ? String(w.lastError) : null;

    let nextRunMs: number | null = null;
    if (lastRunMs !== null) nextRunMs = lastRunMs + finalizerEverySec * 1000;
    else nextRunMs = typeof w?.nextRun === "number" ? w.nextRun : null;

    const now = Date.now();
    const liveSince = lastRunMs !== null ? Math.max(0, Math.floor((now - lastRunMs) / 1000)) : sinceWire;
    const liveTo = nextRunMs !== null ? Math.max(0, Math.floor((nextRunMs - now) / 1000)) : toWire;

    patchSnapshot((prev) => {
      const overall = worstOverall(prev.indexer.level, prev.rpc.level, botLevel);
      return {
        ...prev,
        tsMs: now,
        bot: {
          ...prev.bot,
          level: botLevel,
          label: botLabel,
          running: botRunning,
          lastRunMs,
          nextRunMs,
          finalizerEverySec,
          secondsSinceLastRunWire: sinceWire,
          secondsToNextRunWire: toWire,
          secondsSinceLastRun: liveSince ?? null,
          secondsToNextRun: liveTo ?? null,
          lastError,
          error: undefined,
        },
        overall,
      };
    });
  } catch (e: any) {
    patchSnapshot((prev) => {
      const overall = worstOverall(prev.indexer.level, prev.rpc.level, "unknown");
      return {
        ...prev,
        bot: {
          ...prev.bot,
          level: "unknown",
          label: "Unknown",
          error: String(e?.message || e || "bot_error"),
        },
        overall,
      };
    });
  } finally {
    fetchingBot = false;
  }
}

/* -------------------- full refresh (rpc + meta + bot) -------------------- */

async function runFullOnce() {
  if (fetchingFull) return;
  if (isHidden()) return;

  fetchingFull = true;

  const fetchedAtMs = Date.now();
  const nextPollAt = fetchedAtMs + pollMs;

  try {
    // ---- RPC ----
    let rpcOk = false;
    let rpcLatency: number | null = null;
    let headBlock: number | null = null;
    let rpcErr: string | undefined;

    try {
      const tries = 1;
      const latencies: number[] = [];
      let latestBlock = 0;

      for (let i = 0; i < tries; i++) {
        const r = await rpcEthBlockNumber(rpcUrl, 4000);
        latencies.push(r.latencyMs);
        latestBlock = Math.max(latestBlock, r.block);
      }

      rpcLatency = Math.round(median(latencies));
      headBlock = latestBlock;
      rpcOk = true;
    } catch (e: any) {
      rpcOk = false;
      rpcErr = String(e?.message || e || "rpc_error");
    }

    const rpcS = rpcStatus(rpcLatency, rpcOk);

    // ---- Subgraph meta ----
    let indexedBlock: number | null = null;
    let behind: number | null = null;
    let subErr: string | undefined;

    try {
      indexedBlock = await subgraphIndexedBlock(subgraphUrl, 5000);
      if (headBlock !== null) behind = Math.max(0, headBlock - indexedBlock);
    } catch (e: any) {
      subErr = String(e?.message || e || "subgraph_error");
    }

    const idxS = indexerStatus(behind);

    // ---- Bot status ----
    let botLevel: BotLevel = "unknown";
    let botLabel = "Unknown";
    let botRunning = false;

    let lastRunMs: number | null = null;
    let nextRunMs: number | null = null;

    let sinceWire: number | null = null;
    let toWire: number | null = null;

    let lastError: string | null = null;
    let botErr: string | undefined;

    if (botUrl) {
      try {
        const w = await fetchBotStatus(botUrl, 5000);
        const bs = botStatusFromWire(w);

        botLevel = bs.level;
        botLabel = bs.label;

        botRunning = !!w?.running;
        lastRunMs = typeof w?.lastRun === "number" ? w.lastRun : null;

        sinceWire = clampSec(w?.secondsSinceLastRun);
        toWire = clampSec(w?.secondsToNextRun);
        lastError = w?.lastError ? String(w.lastError) : null;

        if (lastRunMs !== null) nextRunMs = lastRunMs + finalizerEverySec * 1000;
        else nextRunMs = typeof w?.nextRun === "number" ? w.nextRun : null;
      } catch (e: any) {
        botErr = String(e?.message || e || "bot_error");
        botLevel = "unknown";
        botLabel = "Unknown";
      }
    }

    const overall = worstOverall(idxS.level, rpcS.level, botLevel);

    const now = Date.now();
    const liveSince = lastRunMs !== null ? Math.max(0, Math.floor((now - lastRunMs) / 1000)) : sinceWire;
    const liveTo = nextRunMs !== null ? Math.max(0, Math.floor((nextRunMs - now) / 1000)) : toWire;

    setSnapshot({
      tsMs: fetchedAtMs,
      indexer: {
        level: idxS.level,
        label: idxS.label,
        blocksBehind: behind,
        headBlock,
        indexedBlock,
        error: subErr,
      },
      rpc: {
        level: rpcS.level,
        label: rpcS.label,
        latencyMs: rpcLatency,
        ok: rpcOk,
        error: rpcErr,
      },
      bot: {
        level: botLevel,
        label: botLabel,
        running: botRunning,
        lastRunMs,
        nextRunMs,
        finalizerEverySec,
        secondsSinceLastRunWire: sinceWire,
        secondsToNextRunWire: toWire,
        secondsSinceLastRun: liveSince ?? null,
        secondsToNextRun: liveTo ?? null,
        lastError,
        error: botErr,
      },
      overall,
      isLoading: false,
      pollMs,
      nextPollMs: nextPollAt,
      secondsToNextPoll: Math.max(0, Math.floor((nextPollAt - now) / 1000)),
    });
  } finally {
    fetchingFull = false;
  }
}

/* -------------------- timers / lifecycle -------------------- */

function stopBotZeroMode() {
  if (botZeroTimer != null) {
    window.clearInterval(botZeroTimer);
    botZeroTimer = null;
  }
  botZeroTries = 0;
  botZeroBackoffMs = 15_000;
}

function maybeStartBotZeroMode() {
  if (!botUrl) return;
  if (isHidden()) return;

  const secToNext = snapshot.bot.secondsToNextRun;
  const now = Date.now();

  // If nextRunMs is very stale, don't hammer every 5s indefinitely.
  const staleSchedule =
    snapshot.bot.nextRunMs != null ? snapshot.bot.nextRunMs < now - 60_000 : false;

  const shouldZeroPoll = secToNext === 0 && !staleSchedule;

  if (shouldZeroPoll && botZeroTimer == null) {
    botZeroTries = 0;
    botZeroBackoffMs = 15_000;

    void runBotOnlyOnce();
    botZeroTimer = window.setInterval(async () => {
      // Cap fast tries; then back off to protect infra
      botZeroTries += 1;

      if (botZeroTries <= 6) {
        await runBotOnlyOnce();
        return;
      }

      // After 30s of 5s polling, stop the tight loop and back off.
      stopBotZeroMode();
      // backoff kick: schedule one bot-only refresh later
      window.setTimeout(() => void runBotOnlyOnce(), botZeroBackoffMs);
      botZeroBackoffMs = Math.min(60_000, botZeroBackoffMs * 2);
    }, 5_000);
  }

  if (!shouldZeroPoll && botZeroTimer != null) {
    stopBotZeroMode();
  }
}

function tickEverySecond() {
  const now = Date.now();
  patchSnapshot((prev) => {
    const nextPollMs = prev.nextPollMs || now + prev.pollMs;
    const secondsToNextPoll = Math.max(0, Math.floor((nextPollMs - now) / 1000));

    const lastRunMs = prev.bot.lastRunMs;
    const nextRunMs = prev.bot.nextRunMs;

    const secondsSinceLastRun =
      lastRunMs !== null ? Math.max(0, Math.floor((now - lastRunMs) / 1000)) : prev.bot.secondsSinceLastRunWire;

    const secondsToNextRun =
      nextRunMs !== null ? Math.max(0, Math.floor((nextRunMs - now) / 1000)) : prev.bot.secondsToNextRunWire;

    const changed =
      secondsToNextPoll !== prev.secondsToNextPoll ||
      secondsSinceLastRun !== prev.bot.secondsSinceLastRun ||
      secondsToNextRun !== prev.bot.secondsToNextRun;

    if (!changed) return prev;

    return {
      ...prev,
      secondsToNextPoll,
      bot: {
        ...prev.bot,
        secondsSinceLastRun: secondsSinceLastRun ?? null,
        secondsToNextRun: secondsToNextRun ?? null,
      },
    };
  });

  maybeStartBotZeroMode();
}

function onFocusOrVisible() {
  // On focus, do a cheap bot refresh immediately.
  void runBotOnlyOnce();

  // If we've been away for a while, also do a full refresh.
  const staleFull = Date.now() - snapshot.tsMs > Math.max(60_000, pollMs * 2);
  if (staleFull) void runFullOnce();
}

function onPokeRevalidate() {
  const now = Date.now();
  if (now - lastPokeAtMs < POKE_THROTTLE_MS) return;
  lastPokeAtMs = now;
  void runBotOnlyOnce();
}

function startIfNeeded() {
  if (started) return;
  started = true;

  // First full fetch ASAP
  void runFullOnce();

  // Full polling loop
  fullPollTimer = window.setInterval(() => void runFullOnce(), pollMs);

  // 1s tick for countdowns
  secondTickTimer = window.setInterval(tickEverySecond, 1000);

  // Focus/visibility revalidate (cheap + safe)
  window.addEventListener("focus", onFocusOrVisible);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") onFocusOrVisible();
  });

  // Global "poke" after user actions
  window.addEventListener("ppopgi:revalidate", onPokeRevalidate as EventListener);
}

function stopIfPossible() {
  if (subscriberCount > 0) return;

  started = false;

  if (fullPollTimer != null) {
    window.clearInterval(fullPollTimer);
    fullPollTimer = null;
  }
  if (secondTickTimer != null) {
    window.clearInterval(secondTickTimer);
    secondTickTimer = null;
  }

  stopBotZeroMode();

  window.removeEventListener("focus", onFocusOrVisible);
  window.removeEventListener("ppopgi:revalidate", onPokeRevalidate as EventListener);
  // visibilitychange listener was anonymous; we keep it simple and leave it (low risk),
  // but if you want strict cleanup, we can name+remove it.

  // reset poke throttle
  lastPokeAtMs = 0;
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
  // SSR: just return an initial snapshot
  return snapshot;
}

/* -------------------- public hook -------------------- */

export function useInfraStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}