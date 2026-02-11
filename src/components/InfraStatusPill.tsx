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

function componentDotClass(level: string) {
  // levels from your hook: healthy | degraded | late | down | slow | unknown
  // map to the same 4 colors you already have (healthy/degraded/late/down)
  const l = String(level || "").toLowerCase();
  if (l === "healthy") return "healthy";
  if (l === "late") return "late";
  if (l === "down") return "down";
  if (l === "slow") return "degraded"; // rpc slow = orange
  if (l === "unknown") return "degraded"; // treat unknown as orange
  return "degraded";
}

export function InfraStatusPill() {
  const s = useInfraStatus();

  const botLabel = useMemo(() => {
    if (!s.bot) return "Unknown";
    if (s.bot.running) return "Running";
    return s.bot.label || "Unknown";
  }, [s.bot]);

  const overallDot = useMemo(() => componentDotClass(s.overall.level), [s.overall.level]);
  const idxDot = useMemo(() => componentDotClass(s.indexer.level), [s.indexer.level]);
  const rpcDot = useMemo(() => componentDotClass(s.rpc.level), [s.rpc.level]);
  const botDot = useMemo(() => componentDotClass(s.bot?.level || "unknown"), [s.bot?.level]);

  const lastRunText = useMemo(() => fmtAgoSec(s.bot?.secondsSinceLastRun ?? null), [s.bot?.secondsSinceLastRun]);
  const nextRunText = useMemo(() => fmtInSec(s.bot?.secondsToNextRun ?? null), [s.bot?.secondsToNextRun]);

  return (
    <div className="isp-notch" aria-label="Ppopgi systems status">
      <div className="isp-notch-head">
        <div className={`isp-dot ${overallDot}`} aria-hidden="true" />
        <div className="isp-notch-title">
          <div className="isp-notch-title-top">Ppopgi Systems Status</div>
          <div className="isp-notch-title-sub">
            {s.isLoading ? "Checking…" : `Updated ${new Date(s.tsMs).toLocaleTimeString()}`}
          </div>
        </div>
      </div>

      <div className="isp-notch-body">
        {/* Indexer */}
        <div className="isp-line">
          <div className="isp-left">
            <span className={`isp-mini-dot ${idxDot}`} aria-hidden="true" />
            <span className="isp-name">
              Ppopgi Indexer
              <span className="isp-q" tabIndex={0} aria-label="What is the indexer?">
                ?
                <span className="isp-tip" role="tooltip">
                  The indexer reads the blockchain and builds the data used by the app.
                  <br />
                  If it’s behind, pages and stats may update late.
                </span>
              </span>
            </span>
          </div>

          <div className="isp-right">
            <b>{s.indexer.label}</b>
            <span className="isp-muted"> · {fmtBlocksBehind(s.indexer.blocksBehind)}</span>
          </div>
        </div>

        {/* RPC */}
        <div className="isp-line">
          <div className="isp-left">
            <span className={`isp-mini-dot ${rpcDot}`} aria-hidden="true" />
            <span className="isp-name">
              Etherlink RPC
              <span className="isp-q" tabIndex={0} aria-label="What is the RPC?">
                ?
                <span className="isp-tip" role="tooltip">
                  The RPC is the “gateway” your app uses to talk to the blockchain.
                  <br />
                  High latency can make actions feel slow.
                </span>
              </span>
            </span>
          </div>

          <div className="isp-right">
            <b>{s.rpc.label}</b>
            <span className="isp-muted"> · {fmtLatency(s.rpc.latencyMs)}</span>
          </div>
        </div>

        {/* Finalizer */}
        <div className="isp-line">
          <div className="isp-left">
            <span className={`isp-mini-dot ${botDot}`} aria-hidden="true" />
            <span className="isp-name">
              Ppopgi Finalizer Bot
              <span className="isp-q" tabIndex={0} aria-label="What is the finalizer bot?">
                ?
                <span className="isp-tip" role="tooltip">
                  This bot automatically finalizes raffles when they end.
                  <br />
                  If it fails, raffles can stay “pending” longer.
                </span>
              </span>
            </span>
          </div>

          <div className="isp-right">
            <b>{botLabel}</b>
            {s.bot?.lastError ? <span className="isp-muted"> · last error</span> : null}
          </div>
        </div>

        {/* Bot timing */}
        <div className="isp-timing">
          <div className="isp-timing-row">
            <span className="isp-timing-k">Last run</span>
            <span className="isp-timing-v">
              <b>{lastRunText}</b>
            </span>
          </div>
          <div className="isp-timing-row">
            <span className="isp-timing-k">Next run</span>
            <span className="isp-timing-v">
              <b>{nextRunText}</b>
            </span>
          </div>
        </div>

        {s.bot?.lastError && (
          <div className="isp-error" title={s.bot.lastError}>
            {String(s.bot.lastError)}
          </div>
        )}
      </div>
    </div>
  );
}