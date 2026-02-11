// src/hooks/useInfraStatus.ts
import { useEffect, useMemo, useRef, useState } from "react";

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
     * ✅ Derived schedule (UI truth):
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

export function useInfraStatus() {
  const subgraphUrl = useMemo(() => mustEnv("VITE_SUBGRAPH_URL"), []);
  const rpcUrl = useMemo(() => mustEnv("VITE_ETHERLINK_RPC_URL"), []);
  const botUrl = useMemo(() => env("VITE_FINALIZER_STATUS_URL"), []);

  const pollMs = useMemo(() => {
    const v = env("VITE_INFRA_POLL_MS");
    const n = v ? Number(v) : 30000;
    return Number.isFinite(n) ? Math.max(5000, Math.floor(n)) : 30000;
  }, []);

  // ✅ 3 minutes by default, configurable
  const finalizerEverySec = useMemo(() => {
    const v = env("VITE_FINALIZER_EVERY_SEC");
    const n = v ? Number(v) : 180;
    return Number.isFinite(n) ? Math.max(10, Math.floor(n)) : 180;
  }, []);

  const aliveRef = useRef(true);
  const fetchingRef = useRef(false);
  const zeroKickArmedRef = useRef(true);
  const zeroKickTimerRef = useRef<any>(null);

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
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
    nextPollMs: Date.now() + pollMs,
    secondsToNextPoll: Math.floor(pollMs / 1000),
  }));

  const runOnce = async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    const fetchedAtMs = Date.now();
    const nextPollAt = fetchedAtMs + pollMs;

    try {
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
          const w = await fetchBotStatus(botUrl.trim(), 5000);

          const bs = botStatusFromWire(w);
          botLevel = bs.level;
          botLabel = bs.label;

          botRunning = !!w?.running;
          lastRunMs = typeof w?.lastRun === "number" ? w.lastRun : null;

          sinceWire = clampSec(w?.secondsSinceLastRun);
          toWire = clampSec(w?.secondsToNextRun);
          lastError = w?.lastError ? String(w.lastError) : null;

          // ✅ NEW TRUTH: next = last + 3min (or env-defined)
          if (lastRunMs !== null) {
            nextRunMs = lastRunMs + finalizerEverySec * 1000;
          } else {
            nextRunMs = typeof w?.nextRun === "number" ? w.nextRun : null;
          }
        } catch (e: any) {
          botErr = String(e?.message || e || "bot_error");
          botLevel = "unknown";
          botLabel = "Unknown";
        }
      }

      const overall = worstOverall(idxS.level, rpcS.level, botLevel);
      if (!aliveRef.current) return;

      const liveSince =
        lastRunMs !== null ? Math.max(0, Math.floor((Date.now() - lastRunMs) / 1000)) : sinceWire;

      const liveTo =
        nextRunMs !== null ? Math.max(0, Math.floor((nextRunMs - Date.now()) / 1000)) : toWire;

      setState({
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
        secondsToNextPoll: Math.max(0, Math.floor((nextPollAt - Date.now()) / 1000)),
      });

      // ✅ re-arm after successful fetch
      zeroKickArmedRef.current = true;
    } finally {
      fetchingRef.current = false;
    }
  };

  // normal polling
  useEffect(() => {
    let interval: any = null;

    const loop = async () => {
      await runOnce();
      interval = setInterval(runOnce, pollMs);
    };

    void loop();

    return () => {
      try {
        clearInterval(interval);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, rpcUrl, subgraphUrl, botUrl, finalizerEverySec]);

  // every second: recompute live countdowns + force refresh at 0s
  useEffect(() => {
    const now = nowTick;

    // update live countdowns (and refresh-in)
    setState((prev) => {
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

    // ✅ Force refresh when countdown hits 0
    const secToNext = state.bot.secondsToNextRun;
    if (secToNext === 0 && zeroKickArmedRef.current) {
      zeroKickArmedRef.current = false;

      try {
        clearTimeout(zeroKickTimerRef.current);
      } catch {}

      // small delay so the worker has time to update KV
      zeroKickTimerRef.current = setTimeout(() => {
        void runOnce();
      }, 800);
    }

    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick]);

  return state;
}