// src/components/InfraStatusPill.tsx
import { useMemo } from "react";
import { useInfraStatus } from "../hooks/useInfraStatus";
import "./InfraStatusPill.css";

function fmtShort(sec: number | null): string {
  if (sec === null) return "—";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function levelDot(level: string): string {
  // reuse your overall levels; map rpc slow -> degraded if it ever leaks in
  if (level === "slow") return "degraded";
  return level;
}

export function InfraStatusPill() {
  const s = useInfraStatus();

  const indexerHelp =
    "Keeps Ppopgi up-to-date by reading the blockchain and building the data you see in the app (raffles, history, stats).";
  const rpcHelp =
    "A gateway to the Etherlink blockchain. The app and bots use it to read balances and send transactions.";
  const finalizerHelp =
    "A scheduled bot that closes raffles when they end (or cancels them if not enough tickets), then publishes the result.";

  const indexerDot = useMemo(() => `isp-dot ${levelDot(s.indexer.level)}`, [s.indexer.level]);
  const rpcDot = useMemo(() => `isp-dot ${levelDot(s.rpc.level)}`, [s.rpc.level]);

  const botLabel = useMemo(() => {
    if (!s.bot) return "Unknown";
    if (s.bot.running) return "Running";
    return s.bot.label || "Unknown";
  }, [s.bot]);

  const botDot = useMemo(() => `isp-dot ${levelDot(s.bot?.level || "unknown")}`, [s.bot?.level]);

  const botSub = useMemo(() => {
    const to = s.bot?.secondsToNextRun ?? null;
    if (to === null) return null;
    // tiny and friendly countdown
    return ` · next in ${fmtShort(to)}`;
  }, [s.bot?.secondsToNextRun]);

  return (
    // fixed notch container (CSS will anchor it under the topnav)
    <div className="isp-notch" aria-label="Ppopgi systems status">
      <div className="isp-notch-inner">
        <div className="isp-notch-title">Ppopgi Systems Status</div>

        <div className="isp-notch-grid">
          {/* INDEXER */}
          <div className="isp-item">
            <div className="isp-item-left">
              <span className={indexerDot} aria-hidden="true" />
              <span className="isp-item-name">
                Ppopgi Indexer
                <span className="isp-q" title={indexerHelp} aria-label="What is the indexer?">
                  ?
                </span>
              </span>
            </div>

            <div className="isp-item-right">
              <b className="isp-item-status">{s.isLoading ? "Checking…" : s.indexer.label}</b>
              {typeof s.indexer.blocksBehind === "number" && (
                <span className="isp-item-sub">· {s.indexer.blocksBehind} blocks behind</span>
              )}
            </div>
          </div>

          {/* RPC */}
          <div className="isp-item">
            <div className="isp-item-left">
              <span className={rpcDot} aria-hidden="true" />
              <span className="isp-item-name">
                Etherlink RPC
                <span className="isp-q" title={rpcHelp} aria-label="What is the RPC?">
                  ?
                </span>
              </span>
            </div>

            <div className="isp-item-right">
              <b className="isp-item-status">{s.isLoading ? "Checking…" : s.rpc.label}</b>
              {typeof s.rpc.latencyMs === "number" && <span className="isp-item-sub">· {s.rpc.latencyMs}ms</span>}
            </div>
          </div>

          {/* FINALIZER */}
          <div className="isp-item">
            <div className="isp-item-left">
              <span className={botDot} aria-hidden="true" />
              <span className="isp-item-name">
                Ppopgi Finalizer Bot
                <span className="isp-q" title={finalizerHelp} aria-label="What is the finalizer bot?">
                  ?
                </span>
              </span>
            </div>

            <div className="isp-item-right">
              <b className="isp-item-status">{s.isLoading ? "Checking…" : botLabel}</b>
              {botSub ? <span className="isp-item-sub">{botSub}</span> : null}
            </div>
          </div>
        </div>

        <div className="isp-notch-foot">
          Updated: {new Date(s.tsMs).toLocaleTimeString()} · refresh in {fmtShort(s.secondsToNextPoll)}
        </div>
      </div>
    </div>
  );
}