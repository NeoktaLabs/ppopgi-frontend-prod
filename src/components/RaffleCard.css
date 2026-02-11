// src/components/RaffleCard.tsx
import React, { useMemo } from "react";
import type { RaffleListItem } from "../indexer/subgraph";
import { useRaffleCard } from "../hooks/useRaffleCard";
import { useInfraStatus } from "../hooks/useInfraStatus"; // ✅ NEW
import "./RaffleCard.css";

const EXPLORER_URL = "https://explorer.etherlink.com/address/";

type HatchUI = {
  show: boolean;
  ready: boolean;
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  note?: string | null;
};

export type UserEntryStats = {
  count: number;
  percentage: string;
};

type Props = {
  raffle: RaffleListItem;
  onOpen: (id: string) => void;
  onOpenSafety?: (id: string) => void;
  ribbon?: "gold" | "silver" | "bronze";
  nowMs?: number;
  hatch?: HatchUI | null;
  userEntry?: UserEntryStats;
};

const short = (addr: string) => (addr ? `${addr.slice(0, 5)}...${addr.slice(-4)}` : "Unknown");

function clampPct(p: number) {
  if (!isFinite(p) || p <= 0) return "0%";
  if (p < 0.01) return "<0.01%";
  if (p >= 100) return "100%";
  return p < 1 ? `${p.toFixed(2)}%` : `${p.toFixed(1)}%`;
}

// ✅ NEW: show "in Xm Ys" (same format as system notch bot countdown)
function fmtInMinSec(sec: number | null): string {
  if (sec === null) return "—";
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `in ${r}s`;
  return `in ${m}m ${r}s`;
}

export function RaffleCard({ raffle, onOpen, onOpenSafety, ribbon, nowMs = Date.now(), hatch, userEntry }: Props) {
  const { ui, actions } = useRaffleCard(raffle, nowMs);
  const infra = useInfraStatus(); // ✅ NEW

  // -----------------------------
  // ✅ Finalizing rules (card-level)
  // - Max reached => Finalizing
  // - Deadline passed while still OPEN => Finalizing
  // -----------------------------
  const statusRaw = String((raffle as any).status || "");
  const isOpenStatus = statusRaw === "OPEN";

  const maxTicketsN = Number((raffle as any).maxTickets ?? 0);
  const soldN = Number((raffle as any).sold ?? 0);
  const maxReached = maxTicketsN > 0 && soldN >= maxTicketsN;

  const deadlineSec = Number((raffle as any).deadline ?? 0);
  const deadlinePassed = deadlineSec > 0 && nowMs >= deadlineSec * 1000;

  const shouldFinalizing = isOpenStatus && (maxReached || deadlinePassed);

  const displayStatus = shouldFinalizing ? "Finalizing" : ui.displayStatus;

  // ✅ Hide quick-buy if not truly live (also hide on finalizing rules)
  const isLiveForCard = ui.isLive && !shouldFinalizing;

  const statusClass = displayStatus.toLowerCase().replace(" ", "-");
  const cardClass = `rc-card ${ribbon || ""}`;
  const hostAddr = (raffle as any).owner || (raffle as any).creator;

  const winRateLabel = useMemo(() => {
    const max = Number((raffle as any).maxTickets ?? 0);
    const sold = Number((raffle as any).sold ?? 0);

    const denom = max > 0 ? max : sold + 1;
    if (!isFinite(denom) || denom <= 0) return "0%";

    const pct = (1 / denom) * 100;
    return clampPct(pct);
  }, [raffle.maxTickets, raffle.sold]);

  // ✅ NEW: show “Finalizing in …” based on the SAME bot countdown as System Status
  const finalizeCountdown = useMemo(() => {
    const to = infra.bot?.secondsToNextRun ?? null;
    return fmtInMinSec(to);
  }, [infra.bot?.secondsToNextRun]);

  const finalizingLine = useMemo(() => {
    if (!shouldFinalizing) return null;

    // If bot is currently running, communicate that clearly
    if (infra.bot?.running) return "Finalizing now";

    // Otherwise show countdown; fallback if unknown
    return `Finalizing ${finalizeCountdown}`;
  }, [shouldFinalizing, infra.bot?.running, finalizeCountdown]);

  return (
    <div className={cardClass} onClick={() => onOpen(raffle.id)} role="button" tabIndex={0}>
      <div className="rc-notch left" />
      <div className="rc-notch right" />
      {ui.copyMsg && <div className="rc-toast">{ui.copyMsg}</div>}

      {/* Header */}
      <div className="rc-header">
        <div className={`rc-chip ${statusClass}`}>{displayStatus}</div>

        <div className="rc-winrate-badge" title="Win chance per ticket">
          🎲 Win: {winRateLabel}
        </div>

        <div className="rc-actions">
          <button
            className="rc-shield-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSafety?.(raffle.id);
            }}
            title="Verified Contract"
            disabled={!onOpenSafety}
          >
            🛡
          </button>

          <button
            className="rc-btn-icon"
            onClick={(e) => {
              e.stopPropagation();
              actions.handleShare(e);
            }}
            title="Share"
          >
            🔗
          </button>
        </div>
      </div>

      {userEntry && (
        <div className="rc-user-badge">
          🎟️ <strong>{userEntry.count}</strong> Owned ({userEntry.percentage}%)
        </div>
      )}

      <div className="rc-host">
        <span>Created by</span>
        {hostAddr ? (
          <a
            href={`${EXPLORER_URL}${hostAddr}`}
            target="_blank"
            rel="noreferrer"
            className="rc-host-link"
            onClick={(e) => e.stopPropagation()}
          >
            {short(hostAddr)}
          </a>
        ) : (
          <span>PPOPGI</span>
        )}
      </div>

      <div className="rc-title" title={raffle.name}>
        {raffle.name}
      </div>

      {/* Prize Section */}
      <div className="rc-prize-lbl">Current Prize Pool</div>

      <div className="rc-prize-row">
        <div className="rc-prize-val">
          <span className="rc-prize-num">{ui.formattedPot}</span>
          <span className="rc-prize-unit">USDC</span>
        </div>
      </div>

      <div className="rc-prize-note">*See details for prize distribution</div>

      {/* ✅ NEW: Finalizing countdown line (only when finalizing) */}
      {finalizingLine && (
        <div className="rc-prize-note" style={{ marginTop: 8, fontWeight: 900, color: "#0B2E5C" }}>
          ⏳ {finalizingLine}
        </div>
      )}

      <div className="rc-quick-buy-wrapper">
        <div className="rc-perforation" />
        {isLiveForCard && (
          <button
            className="rc-quick-buy-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(raffle.id);
            }}
          >
            ⚡ Buy Ticket
          </button>
        )}
      </div>

      <div className="rc-grid">
        <div className="rc-stat">
          <div className="rc-stat-lbl">Ticket Price</div>
          <div className="rc-stat-val">{ui.formattedPrice} USDC</div>
        </div>
        <div className="rc-stat">
          <div className="rc-stat-lbl">Sold</div>
          <div className="rc-stat-val">
            {ui.sold} {ui.hasMax && `/ ${ui.max}`}
          </div>
        </div>
      </div>

      {isLiveForCard && ui.hasMin && (
        <div className="rc-bar-group">
          {!ui.minReached ? (
            <>
              <div className="rc-bar-row">
                <span>Min To Draw</span>
                <span>
                  {ui.sold} / {ui.min}
                </span>
              </div>
              <div className="rc-track">
                <div className="rc-fill blue" style={{ width: ui.progressMinPct }} />
              </div>
            </>
          ) : (
            <>
              <div className="rc-bar-row">
                <span>Min Reached</span>
                <span>Ready</span>
              </div>
              <div className="rc-track">
                <div className="rc-fill green" style={{ width: "100%" }} />
              </div>

              <div className="rc-bar-row" style={{ marginTop: 8 }}>
                <span>Capacity</span>
                <span>{ui.hasMax ? `${ui.sold} / ${ui.max}` : "Unlimited"}</span>
              </div>
              <div className="rc-track">
                <div className="rc-fill purple" style={{ width: ui.progressMaxPct }} />
              </div>
            </>
          )}
        </div>
      )}

      {hatch && hatch.show && (
        <div className="rc-hatch" onClick={(e) => e.stopPropagation()}>
          <div className="rc-bar-row">
            <span>⚠️ Emergency Hatch</span>
            <span>{hatch.label}</span>
          </div>
          <button
            className={`rc-hatch-btn ${hatch.ready ? "ready" : ""}`}
            disabled={hatch.disabled || hatch.busy}
            onClick={hatch.onClick}
          >
            {hatch.busy ? "CONFIRMING..." : hatch.ready ? "HATCH (CANCEL)" : "LOCKED"}
          </button>
          {hatch.note && (
            <div style={{ fontSize: 10, marginTop: 4, textAlign: "center", fontWeight: 800, textTransform: "uppercase" }}>
              {hatch.note}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="rc-footer-new">
        <div className="rc-footer-left">{isLiveForCard ? `Ends: ${ui.timeLeft}` : displayStatus}</div>
        <div className="rc-footer-right">
          <div className="rc-barcode-div" />
          <a
            href={`${EXPLORER_URL}${raffle.id}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="rc-id-link"
            title="View Contract"
          >
            #{raffle.id.slice(2, 8).toUpperCase()}
          </a>
        </div>
      </div>
    </div>
  );
}