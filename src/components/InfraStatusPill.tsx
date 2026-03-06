// src/components/InfraStatusPill.tsx
import { useMemo, useState } from "react";
import { useInfraStatus } from "../hooks/useInfraStatus";
import "./InfraStatusPill.css";

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

  const overallHealthy = idxDot === "healthy" && rpcDot === "healthy";

  const updatedLabel = useMemo(() => {
    try {
      return new Date(s.tsMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }, [s.tsMs]);

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
          </span>

          <div className="isp-summary-text">
            <span className="isp-summary-title">Ppopgi Systems Status</span>
            <span className="isp-summary-state">
              {s.isLoading ? "Checking..." : overallHealthy ? "All Systems Operational" : "Some Systems Degraded"}
            </span>
          </div>

          {!s.isLoading && <span className="isp-summary-updated">{updatedLabel}</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="isp-notch">
      <div className="isp-notch-inner">
        <div className="isp-notch-grid">
          <div className="isp-item">
            <div className="isp-item-header">
              <span className={`isp-dot ${idxDot}`} />
              <span className="isp-item-name">Indexer</span>
            </div>
            <div className="isp-item-data">
              <div className="isp-item-val">{fmtBlocksBehind(s.indexer.blocksBehind)}</div>
              <div className="isp-item-sub">{s.indexer.label}</div>
            </div>
          </div>

          <div className="isp-item">
            <div className="isp-item-header">
              <span className={`isp-dot ${rpcDot}`} />
              <span className="isp-item-name">Etherlink RPC</span>
            </div>
            <div className="isp-item-data">
              <div className="isp-item-val">{fmtLatency(s.rpc.latencyMs)}</div>
              <div className="isp-item-sub">{s.rpc.label}</div>
            </div>
          </div>
        </div>

        <div className="isp-notch-foot">{s.isLoading ? "Checking..." : `Updated ${updatedLabel}`}</div>

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