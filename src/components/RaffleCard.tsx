// src/components/RaffleCard.tsx
import React, { useMemo } from "react";
import type { RaffleListItem } from "../indexer/subgraph";
import { useRaffleCard } from "../hooks/useRaffleCard";
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

export function RaffleCard({ raffle, onOpen, onOpenSafety, ribbon, nowMs = Date.now(), hatch, userEntry }: Props) {
  const { ui, actions } = useRaffleCard(raffle, nowMs);

  const statusClass = ui.displayStatus.toLowerCase().replace(" ", "-");
  const cardClass = `rc-card ${ribbon || ""}`;
  const hostAddr = (raffle as any).owner || (raffle as any).creator;

  /**
   * ✅ Win rate always shown on the card header (top middle)
   * - Uses maxTickets if defined (better "per ticket chance" framing)
   * - Otherwise uses sold+1 (classic odds while pool grows)
   * - Does NOT hide when userEntry exists (Dashboard)
   * - Does NOT depend on ui.isLive (so you still see it in other states)
   */
  const winRateLabel = useMemo(() => {
    const max = Number((raffle as any).maxTickets ?? 0);
    const sold = Number((raffle as any).sold ?? 0);

    const denom = max > 0 ? max : sold + 1;
    if (!isFinite(denom) || denom <= 0) return "0%";

    const pct = (1 / denom) * 100;
    return clampPct(pct);
  }, [raffle.maxTickets, raffle.sold]);

  return (
    <div className={cardClass} onClick={() => onOpen(raffle.id)} role="button" tabIndex={0}>
      <div className="rc-notch left" />
      <div className="rc-notch right" />
      {ui.copyMsg && <div className="rc-toast">{ui.copyMsg}</div>}

      {/* Header */}
      <div className="rc-header">
        <div className={`rc-chip ${statusClass}`}>{ui.displayStatus}</div>

        {/* ✅ TOP MIDDLE */}
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

          {/* ✅ FIX: pass event to handleShare if it expects one */}
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

      {/* ✅ USDC outside gradient, bigger, aligned */}
      <div className="rc-prize-row">
        <div className="rc-prize-val">
          <span className="rc-prize-num">{ui.formattedPot}</span>
          <span className="rc-prize-unit">USDC</span>
        </div>
      </div>

      {/* ✅ only this line, centered */}
      <div className="rc-prize-note">*See details for prize distribution</div>

      <div className="rc-quick-buy-wrapper">
        <div className="rc-perforation" />
        {ui.isLive && (
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

      {ui.isLive && ui.hasMin && (
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
        <div className="rc-footer-left">{ui.isLive ? `Ends: ${ui.timeLeft}` : ui.displayStatus}</div>
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