// src/components/InfraStatusPill.tsx
import { useMemo } from "react";
import { useInfraStatus } from "../hooks/useInfraStatus";
import "./InfraStatusPill.css";

function fmtAgoSec(sec: number | null): string {
  if (sec === null) return "—";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s ago`;
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
  if (m < 60) return `in ${m}m ${r}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `in ${h}h ${mm}m`;
}

function fmtBlocksBehind(n: number | null): string {
  if (n === null) return "—";
  return `${n} blocks behind`;
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
  if (l === "unknown") return "unknown";
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
        <div className="isp-notch-title">
          <span className={`isp-dot ${overallDot}`} aria-hidden="true" />
          <span style={{ marginLeft: 8 }}>Ppopgi Systems Status</span>
        </div>

        <div className="isp-notch-grid">
          {/* Indexer */}
          <div className="isp-item">
            <div className="isp-item-left">
              <span className={`isp-dot ${idxDot}`} aria-hidden="true" />
              <span className="isp-item-name">
                Ppopgi Indexer
                <span className="isp-q" tabIndex={0} aria-label="What is the indexer?">
                  ?
                  <span className="isp-tip" role="tooltip">
                    Reads the blockchain and builds the data the app shows.
                    <br />
                    If it’s behind, pages and stats update late.
                  </span>
                </span>
              </span>
            </div>

            <div className="isp-item-right">
              <span className="isp-item-status">{s.indexer.label}</span>
              <span className="isp-item-sub">· {fmtBlocksBehind(s.indexer.blocksBehind)}</span>
            </div>
          </div>

          {/* RPC */}
          <div className="isp-item">
            <div className="isp-item-left">
              <span className={`isp-dot ${rpcDot}`} aria-hidden="true" />
              <span className="isp-item-name">
                Etherlink RPC
                <span className="isp-q" tabIndex={0} aria-label="What is the RPC?">
                  ?
                  <span className="isp-tip" role="tooltip">
                    The gateway used to talk to the blockchain.
                    <br />
                    High latency can make actions feel slow.
                  </span>
                </span>
              </span>
            </div>

            <div className="isp-item-right">
              <span className="isp-item-status">{s.rpc.label}</span>
              <span className="isp-item-sub">· {fmtLatency(s.rpc.latencyMs)}</span>
            </div>
          </div>

          {/* Finalizer */}
          <div className="isp-item">
            <div className="isp-item-left">
              <span className={`isp-dot ${botDot}`} aria-hidden="true" />
              <span className="isp-item-name">
                Ppopgi Finalizer Bot
                <span className="isp-q" tabIndex={0} aria-label="What is the finalizer bot?">
                  ?
                  <span className="isp-tip" role="tooltip">
                    Automatically finalizes raffles when they end.
                    <br />
                    If it fails, raffles can stay pending longer.
                  </span>
                </span>
              </span>
            </div>

            <div className="isp-item-right">
              <span className="isp-item-status">{botLabel}</span>
              <span className="isp-item-sub">
                · last {fmtAgoSec(s.bot?.secondsSinceLastRun ?? null)} · next {fmtInSec(s.bot?.secondsToNextRun ?? null)}
              </span>
            </div>
          </div>
        </div>

        <div className="isp-notch-foot">
          {s.isLoading ? "Checking…" : `Updated: ${new Date(s.tsMs).toLocaleTimeString()} · refresh ${fmtInSec(s.secondsToNextPoll)}`}
        </div>
      </div>
    </div>
  );
}