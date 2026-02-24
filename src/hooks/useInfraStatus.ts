// src/hooks/useInfraStatus.ts
import { useEffect, useMemo, useRef, useState } from "react";
import { useRevalidate } from "../hooks/useRevalidateTick";

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

function isHidden() {
  try {
    return typeof document !== "undefined" && document.hidden;
  } catch {
    return false;
  }
}

export function useInfraStatus() {
  const subgraphUrl = useMemo(() => mustEnv("VITE_SUBGRAPH_URL"), []);
  const rpcUrl = useMemo(() => mustEnv("VITE_ETHERLINK_RPC_URL"), []);
  const botUrl = useMemo(() => env("VITE_FINALIZER_STATUS_URL"), []);

  // revalidate tick (app can "poke" infra refresh after actions)
  const rvTick = useRevalidate();
  const lastRvAtRef = useRef<number>(0);

  const pollMs = useMemo(() => {
    const v = env("VITE_INFRA_POLL_MS");
    // ✅ default 60s
    const n = v ? Number(v) : 60_000;
    // ✅ never poll faster than 60s (prevents accidental hammering)
    return Number.isFinite(n) ? Math.max(60_000, Math.floor(n)) : 60_000;
  }, []);

  // 3 minutes by default, configurable
  const finalizerEverySec = useMemo(() => {
    const v = env("VITE_FINALIZER_EVERY_SEC");
    const n = v ? Number(v) : 180;
    return Number.isFinite(n) ? Math.max(10, Math.floor(n)) : 180;
  }, []);

  const aliveRef = useRef(true);
  const fetchingRef = useRef(false);

  // ✅ When bot "Next" hits 0, we bot-poll every 5s until it becomes > 0 (bot-only; no RPC/_meta spam)
  const botZeroModeRef = useRef(false);
  const botZeroIntervalRef = useRef<any>(null);

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stopBotZeroMode = () => {
    botZeroModeRef.current = false;
    try {
      clearInterval(botZeroIntervalRef.current);
    } catch {}
    botZeroIntervalRef.current = null;
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopBotZeroMode();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const runBotOnlyOnce = async () => {
    if (!botUrl) return;
    if (isHidden()) return;

    try {
      const w = await fetchBotStatus(botUrl.trim(), 5000);

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

      if (!aliveRef.current) return;

      setState((prev) => {
        const overall = worstOverall(prev.indexer.level, prev.rpc.level, botLevel);
        return {
          ...prev,
          tsMs: now, // optional: makes “Updated HH:MM” tick during bot-only refresh
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
      if (!aliveRef.current) return;
      setState((prev) => {
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
    }
  };

  const runOnce = async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    const fetchedAtMs = Date.now();
    const nextPollAt = fetchedAtMs + pollMs;

    try {
      // ---- RPC ----
      let rpcOk = false;
      let rpcLatency: number | null = null;
      let headBlock: number | null = null;
      let rpcErr: string | undefined;

      try {
        // ✅ single call per poll
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

      // ---- Bot status (only once per poll) ----
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

          // next = last + finalizerEverySec
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

  // revalidate-driven "poke" (throttled)
  useEffect(() => {
    if (!rvTick) return;
    if (isHidden()) return;

    const now = Date.now();
    // ✅ was 3s — too aggressive for infra checks
    if (now - lastRvAtRef.current < 15_000) return;
    lastRvAtRef.current = now;

    void runOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rvTick]);

  // every second: recompute live countdowns + bot-only refresh at 0s
  useEffect(() => {
    const now = nowTick;

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

    // ✅ Smart: when Next == 0, bot-poll every 5s until it changes (bot-only; no RPC/_meta spam)
    const secToNext = state.bot.secondsToNextRun;
    const shouldZeroPoll = !!botUrl && secToNext === 0 && !isHidden();

    if (shouldZeroPoll && !botZeroModeRef.current) {
      botZeroModeRef.current = true;

      // fire immediately, then every 5s
      void runBotOnlyOnce();
      botZeroIntervalRef.current = setInterval(() => {
        void runBotOnlyOnce();
      }, 5_000);
    }

    if (!shouldZeroPoll && botZeroModeRef.current) {
      stopBotZeroMode();
    }

    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick, state.bot.secondsToNextRun, botUrl, finalizerEverySec]);

  return state;
}