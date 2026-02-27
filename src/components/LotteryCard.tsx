// src/components/LotteryCard.tsx
import React, { useMemo } from "react";
import type { LotteryListItem } from "../indexer/subgraph"; // ✅ updated type
import { useLotteryCard } from "../hooks/useLotteryCard";
import "./LotteryCard.css";

// ✅ NEW: shared UI formatter (removes trailing .0 by default)
import { fmtUsdcUi } from "../lib/format";

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

type FinalizerInfo = {
  running: boolean;
  secondsToNextRun: number | null;
  tsMs: number;
};

type Props = {
  lottery: LotteryListItem;
  onOpen: (id: string) => void;
  onOpenSafety?: (id: string) => void;
  ribbon?: "gold" | "silver" | "bronze";
  nowMs?: number;
  hatch?: HatchUI | null;
  userEntry?: UserEntryStats;
  finalizer?: FinalizerInfo | null;
};

const short = (addr: string) => (addr ? `${addr.slice(0, 5)}...${addr.slice(-4)}` : "Unknown");

function clampPct(p: number) {
  if (!isFinite(p) || p <= 0) return "0%";
  if (p < 0.01) return "<0.01%";
  if (p >= 100) return "100%";
  return p < 1 ? `${p.toFixed(2)}%` : `${p.toFixed(1)}%`;
}

function fmtMinSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

export function LotteryCard({
  lottery,
  onOpen,
  onOpenSafety,
  ribbon,
  nowMs = Date.now(),
  hatch,
  userEntry,
  finalizer,
}: Props) {
  const { ui, actions } = useLotteryCard(lottery, nowMs);

  const statusRaw = String((lottery as any).status || "");
  const isOpenStatus = statusRaw === "OPEN";

  const maxTicketsN = Number((lottery as any).maxTickets ?? 0);
  const soldN = Number((lottery as any).sold ?? 0);
  const maxReached = maxTicketsN > 0 && soldN >= maxTicketsN;

  const deadlineSec = Number((lottery as any).deadline ?? 0);
  const deadlinePassed = deadlineSec > 0 && nowMs >= deadlineSec * 1000;

  const endConditionReached = isOpenStatus && (maxReached || deadlinePassed);

  const minTicketsN = Number((lottery as any).minTickets ?? 0);
  const hasMin = (ui as any)?.hasMin ?? minTicketsN > 0;
  const minReached = (ui as any)?.minReached ?? (hasMin ? soldN >= Math.max(0, minTicketsN) : true);

  type EndMode = "CANCELING" | "DRAWING";
  const endMode: EndMode | null = endConditionReached ? (minReached ? "DRAWING" : "CANCELING") : null;

  const endCountdownSec = useMemo(() => {
    const to = finalizer?.secondsToNextRun ?? null;
    if (to === null) return null;
    const sec = Math.max(0, Math.floor(to));
    return sec === 0 ? 0 : sec;
  }, [finalizer?.secondsToNextRun, finalizer?.tsMs]);

  const endChipNode = useMemo(() => {
    if (!endMode) return null;
    const title = endMode === "CANCELING" ? "Canceling" : "Drawing winner";
    if (finalizer?.running)
      return (
        <>
          {title}
          <br />
          ~ now
        </>
      );
    if (endCountdownSec === null)
      return (
        <>
          {title}
          <br />
          ~ soon
        </>
      );
    return (
      <>
        {title}
        <br />
        ~ {fmtMinSec(endCountdownSec)}
      </>
    );
  }, [endMode, finalizer?.running, endCountdownSec]);

  const displayStatus = endMode ? (endMode === "CANCELING" ? "Canceling" : "Drawing") : ui.displayStatus;
  const isLiveForCard = ui.isLive && !endConditionReached;
  const statusClass = displayStatus.toLowerCase().replace(" ", "-");
  const cardClass = `rc-card ${ribbon || ""}`;

  // ✅ Prefer creator (new data), keep owner fallback only if you still have legacy rows somewhere.
  const hostAddr = (lottery as any).creator || (lottery as any).owner;

  const winRateLabel = useMemo(() => {
    const max = Number((lottery as any).maxTickets ?? 0);
    const sold = Number((lottery as any).sold ?? 0);
    const denom = max > 0 ? max : sold + 1;
    if (!isFinite(denom) || denom <= 0) return "0%";
    return clampPct((1 / denom) * 100);
  }, [lottery.maxTickets, lottery.sold]);

  const endInfoBlock = useMemo(() => {
    if (!endMode) return null;
    if (endMode === "CANCELING") {
      return (
        <div className="rc-end-note">
          <div style={{ marginBottom: 6 }}>Canceling lottery</div>
          <div className="rc-end-sub">
            Min tickets not reached.
            <br />
            Reclaim available soon on your dashboard.
          </div>
        </div>
      );
    }
    const reason = maxReached ? "Sold Out" : "Time's Up";
    return (
      <div className="rc-end-note">
        <div style={{ marginBottom: 6 }}>Drawing Winner ({reason})</div>
        <div className="rc-end-sub">
          Selection pending...
          <br />
          Check back soon.
        </div>
      </div>
    );
  }, [endMode, maxReached]);

  // ✅ Fix TS: title prop cannot be null
  const titleText = lottery.name ?? undefined;
  const displayName = lottery.name ?? "Lottery";

  // ✅ NEW: remove trailing ".0" (and any decimals) for card display only
  const potUi = useMemo(() => fmtUsdcUi(ui.formattedPot, { maxDecimals: 0 }), [ui.formattedPot]);
  const priceUi = useMemo(() => fmtUsdcUi(ui.formattedPrice, { maxDecimals: 0 }), [ui.formattedPrice]);

  return (
    <div className={cardClass} onClick={() => onOpen(lottery.id)} role="button" tabIndex={0}>
      <div className="rc-notch left" />
      <div className="rc-notch right" />
      {ui.copyMsg && <div className="rc-toast">{ui.copyMsg}</div>}

      {/* --- HEADER SECTION --- */}
      <div className="rc-header">
        <div className={`rc-chip ${statusClass}`}>{endMode ? endChipNode : ui.displayStatus}</div>
        <div className="rc-winrate-badge" title="Win chance per ticket">
          🎲 Win: {winRateLabel}
        </div>
        <div className="rc-actions">
          <button
            className="rc-shield-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSafety?.(lottery.id);
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

      <div className="rc-title" title={titleText}>
        {displayName}
      </div>

      {/* --- PRIZE (Holographic) --- */}
      <div className="rc-prize-section">
        <div className="rc-prize-lbl">Prize Pool</div>
        <div className="rc-prize-val">
          <span className="rc-prize-num">{potUi}</span>
          <span className="rc-prize-unit">USDC</span>
        </div>
      </div>

      {/* --- STATS GRID (Moved Up) --- */}
      <div className="rc-grid">
        <div className="rc-stat">
          <div className="rc-stat-lbl">Ticket Price</div>
          <div className="rc-stat-val">{priceUi} USDC</div>
        </div>
        <div className="rc-stat">
          <div className="rc-stat-lbl">Tickets Sold</div>
          <div className="rc-stat-val">
            {ui.sold} {ui.hasMax && `/ ${ui.max}`}
          </div>
        </div>
      </div>

      {/* --- LIQUID BARS (Moved Up) --- */}
      {isLiveForCard && ui.hasMin && (
        <div className="rc-bar-group">
          {!ui.minReached ? (
            <>
              <div className="rc-bar-row">
                <span>Min Target</span>
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
                <span>Total Capacity</span>
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
            <span>⚠️ Emergency</span>
            <span>{hatch.label}</span>
          </div>
          <button
            className={`rc-hatch-btn ${hatch.ready ? "ready" : ""}`}
            disabled={hatch.disabled || hatch.busy}
            onClick={hatch.onClick}
          >
            {hatch.busy ? "..." : hatch.ready ? "HATCH (CANCEL)" : "LOCKED"}
          </button>
        </div>
      )}

      {/* --- TEAR-OFF STUB (Footer Action) --- */}
      <div className="rc-stub-container">
        <div className="rc-perforation-line" />

        <div className="rc-stub-content">
          {/* Action Button */}
          {isLiveForCard ? (
            <button
              className="rc-quick-buy-btn"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(lottery.id);
              }}
            >
              ⚡ Buy Ticket
            </button>
          ) : (
            endInfoBlock
          )}

          {/* Metadata */}
          <div className="rc-stub-meta">
            <div className="rc-meta-left">{isLiveForCard ? `Ends: ${ui.timeLeft}` : displayStatus}</div>
            <div className="rc-meta-right">
              <a
                href={`${EXPLORER_URL}${lottery.id}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rc-id-link"
              >
                #{lottery.id.slice(2, 8).toUpperCase()}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}