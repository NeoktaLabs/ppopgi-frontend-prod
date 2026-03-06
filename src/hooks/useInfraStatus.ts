// src/hooks/useInfraStatus.ts
import { useCallback, useEffect, useState } from "react";

type IndexerLevel = "healthy" | "degraded" | "late" | "down";
type RpcLevel = "healthy" | "degraded" | "slow" | "down";

export type InfraStatus = {
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

  isLoading: boolean;
};

export type UseInfraStatusResult = InfraStatus & {
  refresh: () => Promise<void>;
};

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}

function clampInt(n: any): number | null {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.floor(x));
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

const subgraphUrl = mustEnv("VITE_SUBGRAPH_URL");
const rpcUrl = mustEnv("VITE_ETHERLINK_RPC_URL");

function mkInitial(): InfraStatus {
  const now = Date.now();
  return {
    tsMs: now,
    indexer: { level: "down", label: "Down", blocksBehind: null, headBlock: null, indexedBlock: null },
    rpc: { level: "down", label: "Down", latencyMs: null, ok: false },
    overall: { level: "down", label: "Issues" },
    isLoading: true,
  };
}

export function useInfraStatus(): UseInfraStatusResult {
  const [state, setState] = useState<InfraStatus>(() => mkInitial());

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));

    const fetchedAtMs = Date.now();

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
      overall,
      isLoading: false,
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
  };
}