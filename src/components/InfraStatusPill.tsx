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

export function InfraStatusPill() {
  const s = useInfraStatus();
  const [open, setOpen] = useState(false);

  const dotClass = useMemo(() => `isp-dot ${s.overall.level}`, [s.overall.level]);
  const pillClass = useMemo(() => `isp-pill ${s.overall.level}`, [s.overall.level]);

  const botLabel = useMemo(() => {
    if (!s.bot) return "Unknown";
    if (s.bot.running) return "Running";
    return s.bot.label || "Unknown";
  }, [s.bot]);

  return (
    <div className="isp-wrap" onMouseLeave={() => setOpen(false)}>
      <button type="button" className={pillClass} onClick={() => setOpen((v) => !v)} title="Infra Status">
        <span className={dotClass} aria-hidden="true" />
        <span className="isp-label">{s.isLoading ? "Checking…" : s.overall.label}</span>
      </button>

      {open && (
        <div className="isp-popover" role="dialog" aria-label="Infra status details">
          <div className="isp-row">
            <div className="isp-k">Indexer</div>
            <div className="isp-v">
              <b>{s.indexer.label}</b>
              {typeof s.indexer.blocksBehind === "number" && (
                <span className="isp-muted"> · {s.indexer.blocksBehind} blocks behind</span>
              )}
            </div>
          </div>

          <div className="isp-row">
            <div className="isp-k">RPC</div>
            <div className="isp-v">
              <b>{s.rpc.label}</b>
              {typeof s.rpc.latencyMs === "number" && <span className="isp-muted"> · {s.rpc.latencyMs}ms</span>}
            </div>
          </div>

          <div className="isp-row">
            <div className="isp-k">Finalizer</div>
            <div className="isp-v">
              <b>{botLabel}</b>
              {s.bot?.lastError ? <span className="isp-muted"> · last error</span> : null}
            </div>
          </div>

          <div className="isp-row isp-row-compact">
            <div className="isp-k">Last run</div>
            <div className="isp-v">
              <b>{fmtAgoSec(s.bot?.secondsSinceLastRun ?? null)}</b>
            </div>
          </div>

          <div className="isp-row isp-row-compact">
            <div className="isp-k">Next run</div>
            <div className="isp-v">
              <b>{fmtInSec(s.bot?.secondsToNextRun ?? null)}</b>
            </div>
          </div>

          {s.bot?.lastError && (
            <div className="isp-error" title={s.bot.lastError}>
              {String(s.bot.lastError)}
            </div>
          )}

          <div className="isp-foot">Updated: {new Date(s.tsMs).toLocaleTimeString()}</div>
        </div>
      )}
    </div>
  );
}