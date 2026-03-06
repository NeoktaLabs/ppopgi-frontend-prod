// src/hooks/useInfraStatus.ts
import { useSyncExternalStore } from "react";

/**
 * Core infra hook only:
 * - RPC + /meta only
 * - No bot-status logic
 * - True singleton polling
 * - Poll on mount
 * - Poll every 60s with jitter
 * - Refresh on focus / visibility when stale
 * - No 1s countdown / no per-second rerenders
 */

type IndexerLevel = "healthy" | "degraded" | "late" | "down";
type RpcLevel = "healthy" | "degraded" | "slow" | "down";

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

  overall: {
    level: "healthy" | "degraded" | "late" | "down";
    label: string;
  };

  pollMs: number;
  isLoading: boolean;
};

/* -------------------- env helpers -------------------- */

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}

/* -------------------- small utils -------------------- */

function clampInt(n: any): number | null {
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

function worstOverall(
  indexer: IndexerLevel,
  rpc: RpcLevel
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
      case "healthy":
      default:
        return 1;
    }
  };

  const worst = Math.max(rank(indexer), rank(rpc));

  if (worst >= 4) return { level: "down", label: "Issues" };
  if (indexer === "late") return { level: "late", label: "Late" };
  if (indexer === "degraded" || rpc === "degraded" || rpc === "slow") {
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

/* -------------------- singleton store -------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();

let started = false;
let subscriberCount = 0;

let corePollTimer: number | null = null;
let fetchingCore = false;
let lastCoreAtMs = 0;

const CORE_POLL_MS = 60_000;
const FOCUS_CORE_COOLDOWN_MS = 15_000;

const subgraphUrl = mustEnv("VITE_SUBGRAPH_URL");
const rpcUrl = mustEnv("VITE_ETHERLINK_RPC_URL");

/* -------------------- snapshot -------------------- */

function mkInitial(): InfraStatus {
  const now = Date.now();
  return {
    tsMs: now,
    indexer: { level: "down", label: "Down", blocksBehind: null, headBlock: null, indexedBlock: null },
    rpc: { level: "down", label: "Down", latencyMs: null, ok: false },
    overall: { level: "down", label: "Issues" },
    pollMs: CORE_POLL_MS,
    isLoading: true,
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

/* -------------------- core refresh -------------------- */

async function runCoreOnce() {
  if (fetchingCore) return;
  if (isHidden()) return;

  fetchingCore = true;

  const fetchedAtMs = Date.now();

  try {
    let rpcOk = false;
    let rpcLatency: number | null = null;
    let headBlock: number | null = null;
    let rpcErr: string | undefined;

    try {
      const r = await rpcEthBlockNumber(rpcUrl, 4_000);
      rpcLatency = r.latencyMs;
      headBlock = r.block;
      rpcOk = true;
    } catch (e: any) {
      rpcOk = false;
      rpcErr = String(e?.message || e || "rpc_error");
    }

    const rpcS = rpcStatus(rpcLatency, rpcOk);

    let indexedBlock: number | null = null;
    let behind: number | null = null;
    let subErr: string | undefined;

    try {
      indexedBlock = await subgraphIndexedBlock(subgraphUrl, 5_000);
      if (headBlock !== null) behind = Math.max(0, headBlock - indexedBlock);
    } catch (e: any) {
      subErr = String(e?.message || e || "subgraph_error");
    }

    const idxS = indexerStatus(behind);
    const overall = worstOverall(idxS.level, rpcS.level);

    lastCoreAtMs = Date.now();

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
      overall,
      pollMs: CORE_POLL_MS,
      isLoading: false,
    });
  } finally {
    fetchingCore = false;
  }
}

/* -------------------- timers / lifecycle -------------------- */

function scheduleCoreLoop() {
  if (corePollTimer != null) {
    window.clearTimeout(corePollTimer);
    corePollTimer = null;
  }

  const loop = () => {
    void runCoreOnce();
    corePollTimer = window.setTimeout(loop, jitterMs(CORE_POLL_MS, 0.1, 5_000));
  };

  corePollTimer = window.setTimeout(loop, jitterMs(CORE_POLL_MS, 0.1, 5_000));
}

function onFocusOrVisible() {
  const now = Date.now();
  const staleCore = now - lastCoreAtMs > CORE_POLL_MS;

  if (staleCore && now - lastCoreAtMs > FOCUS_CORE_COOLDOWN_MS) {
    void runCoreOnce();
  }
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    onFocusOrVisible();
  }
}

function startIfNeeded() {
  if (started) return;
  started = true;

  // Poll immediately on mount
  void runCoreOnce();

  // Background 60s resync with jitter
  scheduleCoreLoop();

  window.addEventListener("focus", onFocusOrVisible);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function stopIfPossible() {
  if (subscriberCount > 0) return;

  started = false;

  if (corePollTimer != null) {
    window.clearTimeout(corePollTimer);
    corePollTimer = null;
  }

  window.removeEventListener("focus", onFocusOrVisible);
  document.removeEventListener("visibilitychange", onVisibilityChange);
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

export function useInfraStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}