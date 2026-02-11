// src/components/InfraStatusPill.tsx
import { useMemo } from "react";
import { useInfraStatus } from "../hooks/useInfraStatus";
import "./InfraStatusPill.css";

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.max(0, Math.floor(ms));
  if (s < 1000) return `${s}ms`;
  return `${(s / 1000).toFixed(1)}s`;
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

function tip(text: string) {
  return text;
}

export function InfraStatusPill() {
  const s = useInfraStatus();

  const overallClass = useMemo(() => `isp-notch-inner ${s.overall.level}`, [s.overall.level]);

  const botLabel = useMemo(() => {
    if (!s.bot) return "Unknown";
    if (s.bot.running) return "Running";
    return s.bot.label || "Unknown";
  }, [s.bot]);

  const indexerSub = useMemo(() => {
    if (typeof s.indexer.blocksBehind === "number") return `${s.indexer.blocksBehind} blocks behind`;
    return null;
  }, [s.indexer.blocksBehind]);

  const rpcSub = useMemo(() => {
    if (typeof s.rpc.latencyMs === "number") return fmtMs(s.rpc.latencyMs);
    return null;
  }, [s.rpc.latencyMs]);

  const botSub = useMemo(() => {
    // show live countdown to next run if we have it
    const to = s.bot?.secondsToNextRun ?? null;
    return to === null ? null : fmtInSec(to);
  }, [s.bot?.secondsToNextRun]);

  return (
    <div className="isp-notch" aria-label="Systems status">
      <div className={overallClass}>
        <div className="isp-notch-title">Ppopgi Systems Status</div>

        <div className="isp-notch-grid">
          {/* Indexer */}
          <div className="isp-item">
            <div className="isp-item-left">
              <span className={`isp-dot ${s.indexer.level}`} aria-hidden="true" />
              <div className="isp-item-name">
                Ppopgi Indexer
                <span
                  className="isp-q"
                  title={tip(
                    "Keeps our app data up to date by reading the blockchain and preparing fast queries.\nIf it’s behind, some screens may lag or show stale info."
                  )}
                >
                  ?
                </span>
              </div>
            </div>

            <div className="isp-item-right">
              <span className="isp-item-status">{s.indexer.label}</span>
              {indexerSub ? <span className="isp-item-sub">· {indexerSub}</span> : null}
            </div>
          </div>

          {/* RPC */}
          <div className="isp-item">
            <div className="isp-item-left">
              <span className={`isp-dot ${s.rpc.level}`} aria-hidden="true" />
              <div className="isp-item-name">
                Etherlink RPC
                <span
                  className="isp-q"
                  title={tip(
                    "The blockchain ‘gateway’ the app uses to read data and send transactions.\nIf it’s slow/down, actions like creating or joining raffles may fail."
                  )}
                >
                  ?
                </span>
              </div>
            </div>

            <div className="isp-item-right">
              <span className="isp-item-status">{s.rpc.label}</span>
              {rpcSub ? <span className="isp-item-sub">· {rpcSub}</span> : null}
            </div>
          </div>

          {/* Finalizer */}
          <div className="isp-item">
            <div className="isp-item-left">
              <span className={`isp-dot ${s.bot?.level ?? "unknown"}`} aria-hidden="true" />
              <div className="isp-item-name">
                Ppopgi Finalizer Bot
                <span
                  className="isp-q"
                  title={tip(
                    "Automatically closes raffles after the deadline and triggers finalization.\nIf it errors, raffles might take longer to finalize until it recovers."
                  )}
                >
                  ?
                </span>
              </div>
            </div>

            <div className="isp-item-right">
              <span className="isp-item-status">{botLabel}</span>
              {botSub ? <span className="isp-item-sub">· {botSub}</span> : null}
            </div>
          </div>
        </div>

        <div className="isp-notch-foot">
          Updated: {new Date(s.tsMs).toLocaleTimeString()} · refresh {fmtInSec(s.secondsToNextPoll)}
        </div>
      </div>
    </div>
  );
}