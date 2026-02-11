// src/components/InfraStatusPill.tsx
import { useMemo } from "react";
import { useInfraStatus } from "../hooks/useInfraStatus";
import "./InfraStatusPill.css";

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

function fmtInSec(sec: number | null): string {
  if (sec === null) return "—";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m`;
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
        
        {/* Notch Title */}
        <div className="isp-notch-title">
          <span className={`isp-dot ${overallDot}`} aria-hidden="true" />
          <span style={{ marginLeft: 6 }}>System Status</span>
        </div>

        {/* 3-Column Grid */}
        <div className="isp-notch-grid">
          
          {/* 1. Indexer */}
          <div className="isp-item">
            <div className="isp-item-header">
              <span className={`isp-dot ${idxDot}`} aria-hidden="true" />
              <span className="isp-item-name">Indexer</span>
              <span className="isp-q" tabIndex={0} aria-label="What is the indexer?">
                ?
                <span className="isp-tip" role="tooltip">Reads the blockchain.<br/>If behind, stats update late.</span>
              </span>
            </div>
            <div className="isp-item-data">
              <div className="isp-item-val">{fmtBlocksBehind(s.indexer.blocksBehind)}</div>
              <div className="isp-item-sub">{s.indexer.label}</div>
            </div>
          </div>

          {/* 2. RPC */}
          <div className="isp-item">
            <div className="isp-item-header">
              <span className={`isp-dot ${rpcDot}`} aria-hidden="true" />
              {/* Shortened label for better mobile fit */}
              <span className="isp-item-name">RPC</span>
              <span className="isp-q" tabIndex={0} aria-label="What is the RPC?">
                ?
                <span className="isp-tip" role="tooltip">Gateway to the blockchain.<br/>High latency makes actions slow.</span>
              </span>
            </div>
            <div className="isp-item-data">
              <div className="isp-item-val">{fmtLatency(s.rpc.latencyMs)}</div>
              <div className="isp-item-sub">{s.rpc.label}</div>
            </div>
          </div>

          {/* 3. Finalizer Bot */}
          <div className="isp-item">
            <div className="isp-item-header">
              <span className={`isp-dot ${botDot}`} aria-hidden="true" />
              {/* Shortened label for better mobile fit */}
              <span className="isp-item-name">Bot</span>
              <span className="isp-q" tabIndex={0} aria-label="What is the finalizer bot?">
                ?
                <span className="isp-tip" role="tooltip">Auto-finalizes ended raffles.<br/>Runs every ~5 mins.</span>
              </span>
            </div>
            <div className="isp-item-data">
              <div className="isp-item-val">{botLabel}</div>
              <div className="isp-item-sub">
                Last: {fmtAgoSec(s.bot?.secondsSinceLastRun ?? null)} <br/>
                Next: {fmtInSec(s.bot?.secondsToNextRun ?? null)}
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="isp-notch-foot">
          {s.isLoading 
            ? "Checking..." 
            : `Updated ${new Date(s.tsMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (refresh ${fmtInSec(s.secondsToNextPoll)})`}
        </div>
      </div>
    </div>
  );
}
