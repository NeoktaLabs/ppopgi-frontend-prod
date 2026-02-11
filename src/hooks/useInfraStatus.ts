// src/hooks/useInfraStatus.ts
import { useEffect, useMemo, useRef, useState } from "react";

type IndexerLevel = "healthy" | "degraded" | "late" | "down";
type RpcLevel = "healthy" | "degraded" | "slow" | "down";
type BotLevel = "healthy" | "degraded" | "down" | "unknown";

type InfraStatus = {
  tsMs: number;

  // Indexer status (subgraph)
  indexer: {
    level: IndexerLevel;
    label: string;
    blocksBehind: number | null;
    headBlock: number | null;
    indexedBlock: number | null;
    error?: string;
  };

  // RPC status
  rpc: {
    level: RpcLevel;
    label: string;
    latencyMs: number | null; // median latency
    ok: boolean;
    error?: string;
  };

  // Finalizer bot status
  bot: {
    level: BotLevel;
    label: string;
    running: boolean;
    lastRunMs: number | null;
    nextRunMs: number | null;
    secondsSinceLastRun: number | null;
    secondsToNextRun: number | null;
    lastError?: string | null;
    error?: string;
  };

  // Overall (simple worst-of)
  overall: {
    level: "healthy" | "degraded" | "late" | "down";
    label: string;
  };

  isLoading: boolean;
};

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}

function env(name: string): string | null {
  const v = (import.meta as any).env?.[name];
  return v ? String(v) : null;
}

function clampInt(n: any): number | null {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.floor(x));
}

function median(nums: number[]): number {
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

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
  // Priority order (worst to best)
  const rank = (x: string) => {
    switch (x) {
      case "down":
        return 4;
      case "late":
        return 3;
      case "slow":
        return 2; // rpc-only
      case "degraded":
        return 2;
      case "unknown":
        return 1; // doesn't worsen overall
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
  const query = `query __Meta { _meta { block { number } } }`;
  const res = await withTimeout(
    fetch(subgraphUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    }),
    timeoutMs,
    "subgraph_timeout"
  );

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

/**
 * useInfraStatus
 * - polls RPC + subgraph meta + (optional) bot status endpoint
 * - computes blocksBehind + latency + last/next bot run
 *
 * Env:
 * - VITE_SUBGRAPH_URL (required)
 * - VITE_ETHERLINK_RPC_URL (required)
 * - Optional: VITE_INFRA_POLL_MS (default 30000)
 * - Optional: VITE_FINALIZER_STATUS_URL (e.g. https://neokta-finalizer-bot.<subdomain>.workers.dev)
 */
export function useInfraStatus() {
  const subgraphUrl = useMemo(() => mustEnv("VITE_SUBGRAPH_URL"), []);
  const rpcUrl = useMemo(() => mustEnv("VITE_ETHERLINK_RPC_URL"), []);

  const botBase = useMemo(() => env("VITE_FINALIZER_STATUS_URL"), []);

  const pollMs = useMemo(() => {
    const v = env("VITE_INFRA_POLL_MS");
    const n = v ? Number(v) : 30000;
    return Number.isFinite(n) ? Math.max(5000, Math.floor(n)) : 30000;
  }, []);

  const [state, setState] = useState<InfraStatus>(() => ({
    tsMs: Date.now(),
    indexer: { level: "down", label: "Down", blocksBehind: null, headBlock: null, indexedBlock: null },
    rpc: { level: "down", label: "Down", latencyMs: null, ok: false },
    bot: {
      level: "unknown",
      label: "Unknown",
      running: false,
      lastRunMs: null,
      nextRunMs: null,
      secondsSinceLastRun: null,
      secondsToNextRun: null,
      lastError: null,
    },
    overall: { level: "down", label: "Issues" },
    isLoading: true,
  }));

  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let timer: any = null;

    const runOnce = async () => {
      // ---- RPC (median of 3) ----
      let rpcOk = false;
      let rpcLatency: number | null = null;
      let headBlock: number | null = null;
      let rpcErr: string | undefined;

      try {
        const tries = 3;
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

      // ---- Bot status (optional) ----
      let botLevel: BotLevel = "unknown";
      let botLabel = "Unknown";
      let botRunning = false;
      let lastRunMs: number | null = null;
      let nextRunMs: number | null = null;
      let secondsSinceLastRun: number | null = null;
      let secondsToNextRun: number | null = null;
      let lastError: string | null = null;
      let botErr: string | undefined;

      if (botBase) {
        // ✅ Bot endpoint is /bot-status (not "/")
        const url = botBase.replace(/\/$/, "") + "/bot-status";
        try {
          const w = await fetchBotStatus(url, 5000);
          const bs = botStatusFromWire(w);
          botLevel = bs.level;
          botLabel = bs.label;

          botRunning = !!w?.running;

          // Bot returns timestamps in ms
          lastRunMs = typeof w?.lastRun === "number" ? w.lastRun : null;
          nextRunMs = typeof w?.nextRun === "number" ? w.nextRun : null;

          secondsSinceLastRun = typeof w?.secondsSinceLastRun === "number" ? w.secondsSinceLastRun : null;
          secondsToNextRun = typeof w?.secondsToNextRun === "number" ? w.secondsToNextRun : null;

          lastError = w?.lastError ? String(w.lastError) : null;
        } catch (e: any) {
          botErr = String(e?.message || e || "bot_error");
          // ✅ If we can't reach the bot status endpoint, treat as Down (better UX than "unknown")
          botLevel = "down";
          botLabel = "Down";
        }
      }

      const overall = worstOverall(idxS.level, rpcS.level, botLevel);

      if (!aliveRef.current) return;
      setState({
        tsMs: Date.now(),
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
          secondsSinceLastRun,
          secondsToNextRun,
          lastError,
          error: botErr,
        },
        overall,
        isLoading: false,
      });
    };

    const loop = async () => {
      await runOnce();
      timer = setInterval(runOnce, pollMs);
    };

    void loop();

    return () => {
      try {
        clearInterval(timer);
      } catch {}
    };
  }, [pollMs, rpcUrl, subgraphUrl, botBase]);

  return state;
}