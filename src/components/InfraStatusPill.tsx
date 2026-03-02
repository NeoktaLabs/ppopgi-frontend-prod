// src/components/InfraStatusPill.tsx
import { useMemo, useState } from "react";
import { useInfraStatus } from "../hooks/useInfraStatus";
import "./InfraStatusPill.css";

function fmtAgoSec(sec: number | null): string {
  if (sec === null) return "—";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${String(r).padStart(2, "0")}s ago`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m ago`;
}

function fmtInSec(sec: number | null): string {
  if (sec === null) return "—";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `in ${m}m ${String(r).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `in ${h}h ${mm}m`;
}

function fmtBlocksBehind(n: number | null): string {
  if (n === null) return "—";
  return n === 0 ? "Synced" : `${n} blocks behind`;
}

function fmtLatency(ms: number | null): string {
  if (ms === null) return "—";
  return `${ms}ms`;
}

function dotLevel(level: string): string {
  const l = String(level || "").toLowerCase();

  // ✅ Treat bot lifecycle states as healthy
  // (Many status endpoints call these "running"/"ready"/"ok")
  if (l === "running") return "healthy";
  if (l === "ready") return "healthy";
  if (l === "ok") return "healthy";

  if (l === "healthy") return "healthy";
  if (l === "late") return "late";
  if (l === "down") return "down";
  if (l === "slow") return "slow";
  if (l === "degraded") return "degraded";
  return "unknown";
}

export function InfraStatusPill() {
  const s = useInfraStatus();
  const [expanded, setExpanded] = useState(false);

  const idxDot = useMemo(() => dotLevel(s.indexer.level), [s.indexer.level]);
  const rpcDot = useMemo(() => dotLevel(s.rpc.level), [s.rpc.level]);

  // ✅ Bot dot: if bot is actively running, force it to "healthy" no matter what the hook returns.
  const botDot = useMemo(() => {
    if (s.bot?.running) return "healthy";
    return dotLevel(s.bot?.level || "unknown");
  }, [s.bot?.running, s.bot?.level]);

  // ✅ Overall health: running bot should not count as degraded.
  const overallHealthy =
    idxDot === "healthy" &&
    rpcDot === "healthy" &&
    botDot === "healthy";

  // ---------------------------
  // COLLAPSED VIEW (DEFAULT)
  // ---------------------------
  if (!expanded) {
    return (
      <div className="isp-notch">
        <button
          type="button"
          className={`isp-summary ${overallHealthy ? "all-good" : "has-issues"}`}
          onClick={() => setExpanded(true)}
          aria-label="Expand system status"
        >
          <span className="isp-summary-dots">
            <span className={`isp-dot ${idxDot}`} />
            <span className={`isp-dot ${rpcDot}`} />
            <span className={`isp-dot ${botDot}`} />
          </span>

          <div className="isp-summary-text">
            <span className="isp-summary-title">Ppopgi Systems Status</span>
            <span className="isp-summary-state">
              {s.isLoading
                ? "Checking..."
                : overallHealthy
                ? "All Systems Operational"
                : "Some Systems Degraded"}
            </span>
          </div>

          {!s.isLoading && (
            <span className="isp-summary-updated">
              {new Date(s.tsMs).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </button>
      </div>
    );
  }

  // ---------------------------
  // EXPANDED VIEW
  // ---------------------------
  return (
    <div className="isp-notch">
      <div className="isp-notch-inner">
        <div className="isp-notch-grid">
          {/* Indexer */}
          <div className="isp-item">
            <div className="isp-item-header">
              <span className={`isp-dot ${idxDot}`} />
              <span className="isp-item-name">Indexer</span>
            </div>
            <div className="isp-item-data">
              <div className="isp-item-val">
                {fmtBlocksBehind(s.indexer.blocksBehind)}
              </div>
              <div className="isp-item-sub">{s.indexer.label}</div>
            </div>
          </div>

          {/* RPC */}
          <div className="isp-item">
            <div className="isp-item-header">
              <span className={`isp-dot ${rpcDot}`} />
              <span className="isp-item-name">Etherlink RPC</span>
            </div>
            <div className="isp-item-data">
              <div className="isp-item-val">
                {fmtLatency(s.rpc.latencyMs)}
              </div>
              <div className="isp-item-sub">{s.rpc.label}</div>
            </div>
          </div>

          {/* Bot */}
          <div className="isp-item">
            <div className="isp-item-header">
              <span className={`isp-dot ${botDot}`} />
              <span className="isp-item-name">Finalizer Bot</span>
            </div>
            <div className="isp-item-data">
              <div className="isp-item-val">
                {s.bot?.running ? "Running" : "Ready"}
              </div>
              <div className="isp-item-sub">
                Last: {fmtAgoSec(s.bot?.secondsSinceLastRun ?? null)} | Next:{" "}
                {fmtInSec(s.bot?.secondsToNextRun ?? null)}
              </div>
            </div>
          </div>
        </div>

        <div className="isp-notch-foot">
          {s.isLoading
            ? "Checking..."
            : `Updated ${new Date(s.tsMs).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}`}
        </div>

        <div style={{ textAlign: "center", marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            style={{
              background: "transparent",
              border: "none",
              fontWeight: 800,
              fontSize: 12,
              cursor: "pointer",
              color: "var(--ink)",
              opacity: 0.6,
              padding: "4px 12px",
            }}
          >
            Collapse
          </button>
        </div>
      </div>
    </div>
  );
}