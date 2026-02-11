// src/components/InfraStatusPill.tsx
import { useMemo } from "react";
import { useInfraStatus } from "../hooks/useInfraStatus";
import "./InfraStatusPill.css";

// Helper to keep time very short (e.g., "4m ago")
function fmtAgoSec(sec: number | null): string {
  if (sec === null) return "—";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m ago`;
}

function fmtBlocksBehind(n: number | null): string {
  if (n === null) return "—";
  return n === 0 ? "Synced" : `-${n} blks`;
}

function fmtLatency(ms: number | null): string {
  if (ms === null) return "—";
  return `${ms}ms`;
}

function dotLevel(level: string): string {
  const l = String(level || "").toLowerCase();
  if (l === "healthy") return "healthy";
  if (l === "late") return "late";
  if (l === "down") return "down";
  if (l === "slow") return "slow";
  if (l === "degraded") return "degraded";
  return "unknown";
}

export function InfraStatusPill() {
  const s = useInfraStatus();

  const botLabel = useMemo(() => {
    if (!s.bot) return "Unknown";
    if (s.bot.running) return "Running";
    return s.bot.label || "Unknown";
  }, [s.bot]);

  const overallDot = useMemo(() => dotLevel(s.overall.level), [s.overall.level]);
  const idxDot = useMemo(() => dotLevel(s.indexer.level), [s.indexer.level]);
  const rpcDot = useMemo(() => dotLevel(s.rpc.level), [s.rpc.level]);
  const botDot = useMemo(() => dotLevel(s.bot?.level || "unknown"), [s.bot?.level]);

  return (
    <div className="isp-notch" aria-label="Ppopgi systems status">
      <div className="isp-notch-inner">
        
        {/* Left: Overall Status */}
        <div className="isp-notch-title">
          <span className={`isp-dot ${overallDot}`} aria-hidden="true" />
          <span className="isp-title-text">Systems</span>
        </div>

        <div className="isp-divider hide-mobile" />

        {/* Middle: Horizontal Metrics */}
        <div className="isp-notch-grid">
          
          {/* Indexer */}
          <div className="isp-item">
            <span className="isp-item-name">Idx:</span>
            <span className="isp-item-val">{fmtBlocksBehind(s.indexer.blocksBehind)}</span>
            <span className={`isp-dot-small ${idxDot}`} aria-hidden="true" />
            <span className="isp-q" tabIndex={0}>
              ?
              <span className="isp-tip">Reads the blockchain.<br/>If behind, stats update late.</span>
            </span>
          </div>

          {/* RPC */}
          <div className="isp-item">
            <span className="isp-item-name">RPC:</span>
            <span className="isp-item-val">{fmtLatency(s.rpc.latencyMs)}</span>
            <span className={`isp-dot-small ${rpcDot}`} aria-hidden="true" />
            <span className="isp-q" tabIndex={0}>
              ?
              <span className="isp-tip">Gateway to the blockchain.<br/>High latency makes actions slow.</span>
            </span>
          </div>

          {/* Bot */}
          <div className="isp-item">
            <span className="isp-item-name">Bot:</span>
            <span className="isp-item-val">{botLabel}</span>
            <span className={`isp-dot-small ${botDot}`} aria-hidden="true" />
            <span className="isp-q" tabIndex={0}>
              ?
              <span className="isp-tip">Auto-finalizes ended raffles.<br/>Last run: {fmtAgoSec(s.bot?.secondsSinceLastRun ?? null)}</span>
            </span>
          </div>

        </div>

        <div className="isp-divider hide-mobile" />

        {/* Right: Last Updated */}
        <div className="isp-notch-foot hide-mobile">
          {s.isLoading 
            ? "..." 
            : new Date(s.tsMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        
      </div>
    </div>
  );
}
