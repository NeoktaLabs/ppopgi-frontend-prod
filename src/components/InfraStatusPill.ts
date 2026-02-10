// src/components/InfraStatusPill.tsx
import { useMemo, useState } from "react";
import { useInfraStatus } from "../hooks/useInfraStatus";
import "./InfraStatusPill.css";

export function InfraStatusPill() {
  const s = useInfraStatus();
  const [open, setOpen] = useState(false);

  const dotClass = useMemo(() => {
    return `isp-dot ${s.overall.level}`;
  }, [s.overall.level]);

  const pillClass = useMemo(() => {
    return `isp-pill ${s.overall.level}`;
  }, [s.overall.level]);

  return (
    <div className="isp-wrap" onMouseLeave={() => setOpen(false)}>
      <button type="button" className={pillClass} onClick={() => setOpen((v) => !v)} title="Infra Status">
        <span className={dotClass} aria-hidden="true" />
        <span className="isp-label">
          {s.isLoading ? "Checking…" : s.overall.label}
        </span>
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
              {typeof s.rpc.latencyMs === "number" && (
                <span className="isp-muted"> · {s.rpc.latencyMs}ms</span>
              )}
            </div>
          </div>

          <div className="isp-foot">
            Updated: {new Date(s.tsMs).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}