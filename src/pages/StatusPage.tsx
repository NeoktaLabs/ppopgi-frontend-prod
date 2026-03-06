import { useMemo } from "react";
import { useInfraStatus } from "../hooks/useInfraStatus";
import "./StatusPage.css";

function fmtLatency(ms: number | null) {
  if (ms == null) return "—";
  return `${ms} ms`;
}

function fmtBlocks(n: number | null) {
  if (n == null) return "—";
  if (n === 0) return "Synced";
  return `${n.toLocaleString("en-US")} blocks behind`;
}

function fmtBlock(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function fmtUpdated(tsMs: number) {
  try {
    return new Date(tsMs).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

function levelClass(level: string) {
  const l = String(level || "").toLowerCase();
  if (l === "healthy") return "is-healthy";
  if (l === "degraded" || l === "slow") return "is-degraded";
  if (l === "late") return "is-late";
  if (l === "down") return "is-down";
  return "is-unknown";
}

export function StatusPage() {
  const infra = useInfraStatus();

  const updatedAt = useMemo(() => fmtUpdated(infra.tsMs), [infra.tsMs]);

  return (
    <div className="sp-wrap">
      <div className="sp-shell">
        <div className="sp-hero">
          <div className="sp-kicker">Infrastructure Status</div>
          <h1 className="sp-title">RPC & Indexer Health</h1>
          <p className="sp-sub">
            This page checks Etherlink RPC latency and subgraph indexing status on demand.
          </p>

          <div className="sp-hero-row">
            <div className={`sp-overall ${levelClass(infra.overall.level)}`}>
              <span className="sp-dot" />
              <span className="sp-overall-label">Overall</span>
              <strong>{infra.overall.label}</strong>
            </div>

            <button
              type="button"
              className="sp-refresh-btn"
              onClick={() => void infra.refresh()}
              disabled={infra.isLoading}
            >
              {infra.isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="sp-updated">
            {infra.isLoading ? "Checking infrastructure..." : `Last checked: ${updatedAt}`}
          </div>
        </div>

        <div className="sp-grid">
          <section className="sp-card">
            <div className="sp-card-head">
              <div className={`sp-badge ${levelClass(infra.rpc.level)}`}>
                <span className="sp-dot" />
                RPC
              </div>
              <div className="sp-card-title">Etherlink RPC</div>
            </div>

            <div className="sp-metric">{fmtLatency(infra.rpc.latencyMs)}</div>
            <div className="sp-caption">{infra.rpc.label}</div>

            <div className="sp-list">
              <div className="sp-row">
                <span>Reachable</span>
                <strong>{infra.rpc.ok ? "Yes" : "No"}</strong>
              </div>
              <div className="sp-row">
                <span>Latency</span>
                <strong>{fmtLatency(infra.rpc.latencyMs)}</strong>
              </div>
              <div className="sp-row">
                <span>Error</span>
                <strong className="sp-mono">{infra.rpc.error || "—"}</strong>
              </div>
            </div>
          </section>

          <section className="sp-card">
            <div className="sp-card-head">
              <div className={`sp-badge ${levelClass(infra.indexer.level)}`}>
                <span className="sp-dot" />
                Indexer
              </div>
              <div className="sp-card-title">Subgraph /meta</div>
            </div>

            <div className="sp-metric">{fmtBlocks(infra.indexer.blocksBehind)}</div>
            <div className="sp-caption">{infra.indexer.label}</div>

            <div className="sp-list">
              <div className="sp-row">
                <span>RPC head block</span>
                <strong>{fmtBlock(infra.indexer.headBlock)}</strong>
              </div>
              <div className="sp-row">
                <span>Indexed block</span>
                <strong>{fmtBlock(infra.indexer.indexedBlock)}</strong>
              </div>
              <div className="sp-row">
                <span>Behind</span>
                <strong>{fmtBlocks(infra.indexer.blocksBehind)}</strong>
              </div>
              <div className="sp-row">
                <span>Error</span>
                <strong className="sp-mono">{infra.indexer.error || "—"}</strong>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}