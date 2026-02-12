// src/components/RaffleDetailsModal.tsx
import { useState, useEffect, useMemo } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useRaffleInteraction } from "../hooks/useRaffleInteraction";
import { useRaffleParticipants } from "../hooks/useRaffleParticipants";
import { fetchRaffleMetadata, type RaffleListItem } from "../indexer/subgraph";
import "./RaffleDetailsModal.css";

const ZERO = "0x0000000000000000000000000000000000000000";

const ExplorerLink = ({ addr, label }: { addr: string; label?: string }) => {
  if (!addr || String(addr).toLowerCase() === ZERO) return <span>{label || "—"}</span>;
  const a = String(addr).toLowerCase();
  return (
    <a href={`https://explorer.etherlink.com/address/${a}`} target="_blank" rel="noreferrer" className="rdm-info-link">
      {label || `${a.slice(0, 6)}...${a.slice(-4)}`}
    </a>
  );
};

const TxLink = ({ hash }: { hash?: string | null }) => {
  if (!hash) return null;
  const h = String(hash).toLowerCase();
  return (
    <a href={`https://explorer.etherlink.com/tx/${h}`} target="_blank" rel="noreferrer" className="rdm-tl-tx">
      View Tx ↗
    </a>
  );
};

const formatDate = (ts: any) => {
  if (!ts || ts === "0") return "—";
  return new Date(Number(ts) * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

type RaffleEventRow = {
  type: string;
  blockTimestamp: string;
  txHash: string;
  actor?: string | null;
  target?: string | null;
  uintValue?: string | null;
  amount?: string | null;
  amount2?: string | null;
  text?: string | null;
  requestId?: string | null;
};

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}

async function fetchRaffleEvents(raffleId: string): Promise<RaffleEventRow[]> {
  const url = mustEnv("VITE_SUBGRAPH_URL");
  const query = `
    query RaffleJourney($id: Bytes!, $first: Int!) {
      raffleEvents(
        first: $first
        orderBy: blockTimestamp
        orderDirection: asc
        where: { raffle: $id }
      ) {
        type
        blockTimestamp
        txHash
        actor
        target
        uintValue
        amount
        amount2
        text
        requestId
      }
    }
  `;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { id: raffleId.toLowerCase(), first: 200 } }),
    });

    const json = await res.json();
    if (!res.ok || json?.errors?.length) return [];
    return (json.data?.raffleEvents ?? []) as RaffleEventRow[];
  } catch {
    return [];
  }
}

type Props = {
  open: boolean;
  raffleId: string | null;
  onClose: () => void;
  initialRaffle?: RaffleListItem | null;
};

function clampPct(p: number) {
  if (!isFinite(p) || p <= 0) return "0%";
  if (p < 0.01) return "<0.01%";
  if (p >= 100) return "100%";
  return p < 1 ? `${p.toFixed(2)}%` : `${p.toFixed(1)}%`;
}

function fmtNum(n: number) {
  const safe = isFinite(n) ? n : 0;
  return safe.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function clampTicketsUi(v: any) {
  const n = Math.floor(Number(String(v ?? "").trim()));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, n);
}

// --------------------------
// ✅ merge helpers
// --------------------------
const norm = (v: any) => String(v ?? "").trim();
const isZeroAddr = (v: any) => norm(v).toLowerCase() === ZERO;
const isZeroNumStr = (v: any) => {
  const s = norm(v);
  if (!s) return true;
  return s === "0" || s === "0n" || s === "0.0";
};
function pickNonZeroNum(primary: any, fallback: any) {
  return !isZeroNumStr(primary) ? primary : fallback;
}
function pickNonZeroAddr(primary: any, fallback: any) {
  return primary && !isZeroAddr(primary) ? primary : fallback;
}
function pickTruthy(primary: any, fallback: any) {
  const p = primary;
  return p !== null && p !== undefined && norm(p) !== "" ? p : fallback;
}

/**
 * IMPORTANT: Don't allow onchain fallback "0" / ZERO to override subgraph base.
 * This keeps your UI non-zero while onchain calls are flaky/timeouting.
 */
function mergeDisplayData(onchain: any, base: any) {
  if (!onchain && !base) return null;
  const b = base || {};
  const o = onchain || {};

  return {
    ...b,

    // strings
    name: pickTruthy(o.name, b.name),

    // numbers-as-strings
    winningPot: pickNonZeroNum(o.winningPot, b.winningPot),
    ticketPrice: pickNonZeroNum(o.ticketPrice, b.ticketPrice),
    sold: pickNonZeroNum(o.sold, b.sold),
    ticketRevenue: pickNonZeroNum(o.ticketRevenue, b.ticketRevenue),
    minTickets: pickNonZeroNum(o.minTickets, b.minTickets),
    maxTickets: pickNonZeroNum(o.maxTickets, b.maxTickets),
    deadline: pickNonZeroNum(o.deadline, b.deadline),
    protocolFeePercent: pickNonZeroNum(o.protocolFeePercent, b.protocolFeePercent),
    minPurchaseAmount: pickNonZeroNum(o.minPurchaseAmount, b.minPurchaseAmount),

    // addresses
    creator: pickNonZeroAddr(o.creator, b.creator),
    usdcToken: pickNonZeroAddr(o.usdcToken, b.usdcToken ?? b.usdc),
    feeRecipient: pickNonZeroAddr(o.feeRecipient, b.feeRecipient),
    winner: pickNonZeroAddr(o.winner, b.winner),

    // status
    status: pickTruthy(o.status, b.status),

    // timestamps / tx (from onchain history if present, but don't override with zeros)
    createdAtTimestamp: pickNonZeroNum(o?.history?.createdAtTimestamp, b.createdAtTimestamp),
    creationTx: pickTruthy(o?.history?.creationTx, b.creationTx),
    completedAt: pickNonZeroNum(o?.history?.completedAt, b.completedAt),
    canceledAt: pickNonZeroNum(o?.history?.canceledAt, b.canceledAt),
    registeredAt: pickNonZeroNum(o?.history?.registeredAt, b.registeredAt),

    // bool
    paused: typeof o.paused === "boolean" ? o.paused : b.paused,

    history: o.history ?? b.history,
  };
}

export function RaffleDetailsModal({ open, raffleId, onClose, initialRaffle }: Props) {
  const { state, math, flags, actions } = useRaffleInteraction(raffleId, open);
  const account = useActiveAccount();

  const [tab, setTab] = useState<"receipt" | "holders">("receipt");
  const [metadata, setMetadata] = useState<Partial<RaffleListItem> | null>(null);
  const [events, setEvents] = useState<RaffleEventRow[] | null>(null);

  useEffect(() => {
    if (!raffleId || !open) {
      setMetadata(null);
      setEvents(null);
      setTab("receipt");
      return;
    }

    if (initialRaffle?.createdAtTimestamp) setMetadata(initialRaffle);

    let active = true;

    if (!initialRaffle?.createdAtTimestamp) {
      fetchRaffleMetadata(raffleId).then((data) => {
        if (active && data) setMetadata(data);
      });
    }

    fetchRaffleEvents(raffleId).then((rows) => {
      if (!active) return;
      setEvents(rows);
    });

    return () => {
      active = false;
    };
  }, [raffleId, open, initialRaffle]);

  // ✅ Keep the same "works like a charm" structure:
  // base = initialRaffle/metadata, overlay = state.data (onchain)
  const baseData = (initialRaffle || metadata) as any;
  const onchainData = state.data as any;

  // ✅ merged displayData so you don't see zeros everywhere
  const displayData = useMemo(() => mergeDisplayData(onchainData, baseData), [onchainData, baseData]);

  // ✅ holders % must use merged sold
  const soldForPct = Number(displayData?.sold || 0);
  const { participants, isLoading: loadingPart } = useRaffleParticipants(raffleId, soldForPct);

  const timeline = useMemo(() => {
    if (!displayData) return [];

    const steps: any[] = [];
    const findFirst = (t: string) => (events ?? []).find((e) => e.type === t) || null;

    const deployed = findFirst("LOTTERY_DEPLOYED");
    const registered = findFirst("LOTTERY_REGISTERED");
    const funding = findFirst("FUNDING_CONFIRMED");
    const finalized = findFirst("LOTTERY_FINALIZED");
    const winner = findFirst("WINNER_PICKED");
    const canceled = findFirst("LOTTERY_CANCELED");

    steps.push({
      label: "Initialized",
      date: displayData.createdAtTimestamp || deployed?.blockTimestamp || null,
      tx: displayData.creationTx || deployed?.txHash || null,
      status: "done",
    });

    if (registered) {
      steps.push({ label: "Registered", date: registered.blockTimestamp, tx: registered.txHash, status: "done" });
    } else if (displayData.registeredAt) {
      steps.push({ label: "Registered", date: displayData.registeredAt, tx: null, status: "done" });
    } else {
      steps.push({ label: "Registered", date: null, tx: null, status: "future" });
    }

    const status = displayData.status;

    if (funding) {
      steps.push({ label: "Ticket Sales Open", date: funding.blockTimestamp, tx: funding.txHash, status: "done" });
    } else {
      const s =
        status === "OPEN" || status === "DRAWING" || status === "COMPLETED" || status === "CANCELED"
          ? "active"
          : "future";
      steps.push({ label: "Ticket Sales Open", date: null, tx: null, status: s });
    }

    if (finalized) {
      steps.push({ label: "Randomness Requested", date: finalized.blockTimestamp, tx: finalized.txHash, status: "done" });
    } else if (status === "DRAWING") {
      steps.push({ label: "Randomness Requested", date: null, tx: null, status: "active" });
    } else {
      steps.push({
        label: "Draw Deadline",
        date: displayData.deadline || null,
        tx: null,
        status: status === "OPEN" ? "active" : "future",
      });
    }

    if (winner) {
      steps.push({
        label: "Winner Selected",
        date: winner.blockTimestamp,
        tx: winner.txHash,
        status: "done",
        winner: displayData.winner || winner.actor || null,
      });
    } else if (canceled) {
      steps.push({ label: "Canceled", date: canceled.blockTimestamp, tx: canceled.txHash, status: "done" });
    } else if (status === "COMPLETED") {
      steps.push({
        label: "Winner Selected",
        date: displayData.completedAt || null,
        tx: null,
        status: "done",
        winner: displayData.winner || null,
      });
    } else if (status === "CANCELED") {
      steps.push({ label: "Canceled", date: displayData.canceledAt || null, tx: null, status: "done" });
    } else {
      steps.push({ label: "Settlement", date: null, tx: null, status: "future" });
    }

    return steps;
  }, [displayData, events]);

  const stats = useMemo(() => {
    if (!displayData) return null;

    const sold = Number(displayData.sold || "0");
    const oddsPct = sold >= 0 ? clampPct(100 / (sold + 1)) : "0%";

    const pot = parseFloat(math.fmtUsdc(displayData.winningPot || "0"));
    const price = parseFloat(math.fmtUsdc(displayData.ticketPrice || "0"));

    const netPot = pot * 0.9;
    const roi = price > 0 ? (netPot / price).toFixed(1) : "0";

    return { roi, oddsPct, price };
  }, [displayData, math]);

  const distribution = useMemo(() => {
    if (!displayData) return null;

    const status = String(displayData.status || "");
    const isSettled = status === "COMPLETED";
    const isCanceled = status === "CANCELED";

    const pot = parseFloat(math.fmtUsdc(displayData.winningPot || "0"));
    const sold = Number(displayData.sold || 0);
    const ticketPrice = parseFloat(math.fmtUsdc(displayData.ticketPrice || "0"));
    const grossSales = ticketPrice * sold;

    const winnerNet = pot * 0.9;
    const platformPrizeFee = pot * 0.1;
    const prizeTotal = winnerNet + platformPrizeFee;

    const creatorNet = grossSales * 0.9;
    const platformSalesFee = grossSales * 0.1;
    const salesTotal = creatorNet + platformSalesFee;

    return { isSettled, isCanceled, winnerNet, platformPrizeFee, prizeTotal, creatorNet, platformSalesFee, salesTotal };
  }, [displayData, math]);

  const creatorAddr = String(displayData?.creator || "").toLowerCase();
  const meAddr = String(account?.address || "").toLowerCase();
  const isCreator = !!creatorAddr && !!meAddr && creatorAddr === meAddr;

  // Keep UI tickets clamped into [1..maxBuy]
  const maxBuy = Math.max(1, math.maxBuy);
  const uiTicket = clampTicketsUi(state.tickets);
  const clampedUiTicket = Math.min(uiTicket, maxBuy);

  useEffect(() => {
    if (!open || !raffleId) return;
    if (String(clampedUiTicket) !== String(state.tickets)) actions.setTickets(String(clampedUiTicket));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, raffleId, maxBuy]);

  if (!open) return null;

  const createdOnTs = timeline?.[0]?.date ?? null;
  const showRemainingNote = typeof (math as any).remainingTickets === "number" && (math as any).remainingTickets > 0;

  // blur buy section if not connected
  const blurBuy = !state.isConnected;

  // show balance warning when connected + allowance ok + not enough balance
  const showBalanceWarn = state.isConnected && flags.hasEnoughAllowance && !flags.hasEnoughBalance;

  return (
    <div className="rdm-overlay" onMouseDown={onClose}>
      <div className="rdm-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="rdm-header">
          <div style={{ display: "flex", gap: 8 }}>
            <button className="rdm-close-btn" onClick={actions.handleShare} title="Copy Link">
              🔗
            </button>
          </div>
          <div style={{ fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            TICKET #{raffleId?.slice(2, 8).toUpperCase()}
          </div>
          <button className="rdm-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="rdm-hero">
          <div className="rdm-hero-lbl">Total Prize Pool</div>

          <div className="rdm-hero-val">
            {math.fmtUsdc(displayData?.winningPot || "0")} <span className="rdm-hero-unit">USDC</span>
          </div>

          <div className="rdm-hero-meta">
            <div className="rdm-host">
              <span>Created by</span>
              <ExplorerLink addr={String(displayData?.creator || "")} label={math.short(String(displayData?.creator || ""))} />
            </div>
            <div className="rdm-createdon">
              <span>Created on</span>
              <span className="rdm-createdon-val">{formatDate(createdOnTs)}</span>
            </div>
          </div>
        </div>

        {stats && (
          <div className="rdm-stats-grid">
            <div className="rdm-stat-box highlight">
              <div className="rdm-sb-lbl">Net Payout</div>
              <div className="rdm-sb-val rdm-roi-badge">{stats.roi}x</div>
            </div>

            <div className="rdm-stat-box">
              <div className="rdm-sb-lbl">Win Odds</div>
              <div className="rdm-sb-val">{stats.oddsPct}</div>
            </div>

            <div className="rdm-stat-box">
              <div className="rdm-sb-lbl">Ticket price</div>
              <div className="rdm-sb-val">
                {stats.price} <span style={{ fontSize: 11, opacity: 0.7, fontWeight: 800 }}>USDC</span>
              </div>
            </div>
          </div>
        )}

        {distribution && (
          <>
            {distribution.isCanceled ? (
              <div className="rdm-dist rdm-dist-canceled">
                <div className="rdm-dist-title">Prize & sales distribution</div>
                <div className="rdm-dist-note warn">
                  This raffle was canceled. If you purchased tickets, you can reclaim your ticket cost from your dashboard.
                </div>
              </div>
            ) : (
              <div className="rdm-dist">
                <div className="rdm-dist-title">Prize & sales distribution</div>

                <div className={`rdm-dist-note ${distribution.isSettled ? "ok" : "warn"}`}>
                  {distribution.isSettled
                    ? "Settlement is complete — amounts below are final."
                    : "Only valid once the raffle is settled (COMPLETED). Values shown are live projections."}
                </div>

                <div className="rdm-dist-subtitle">Prize distribution</div>
                <div className="rdm-dist-grid">
                  <div className="rdm-dist-row">
                    <span className="rdm-dist-k">Winner (net)</span>
                    <span className="rdm-dist-v">{fmtNum(distribution.winnerNet)} USDC</span>
                  </div>

                  <div className="rdm-dist-row">
                    <span className="rdm-dist-k">Platform fee (prize)</span>
                    <span className="rdm-dist-v">{fmtNum(distribution.platformPrizeFee)} USDC</span>
                  </div>

                  <div className="rdm-dist-row rdm-dist-total">
                    <span className="rdm-dist-k">Total</span>
                    <span className="rdm-dist-v">{fmtNum(distribution.prizeTotal)} USDC</span>
                  </div>
                </div>

                <div className="rdm-dist-divider" />

                <div className="rdm-dist-subtitle">Ticket sales distribution</div>
                <div className="rdm-dist-grid">
                  <div className="rdm-dist-row">
                    <span className="rdm-dist-k">Creator (net)</span>
                    <span className="rdm-dist-v">{fmtNum(distribution.creatorNet)} USDC</span>
                  </div>

                  <div className="rdm-dist-row">
                    <span className="rdm-dist-k">Platform fee (sales)</span>
                    <span className="rdm-dist-v">{fmtNum(distribution.platformSalesFee)} USDC</span>
                  </div>

                  <div className="rdm-dist-row rdm-dist-total">
                    <span className="rdm-dist-k">Total</span>
                    <span className="rdm-dist-v">{fmtNum(distribution.salesTotal)} USDC</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div className="rdm-tear" />

        {/* ✅ BUY SECTION (kept EXACTLY like your “works like a charm” version) */}
        <div className="rdm-buy-section">
          {!flags.raffleIsOpen ? (
            <div style={{ textAlign: "center", padding: 20, opacity: 0.6, fontWeight: 700 }}>
              {state.displayStatus === "Finalizing" ? "Raffle is finalizing..." : "Raffle Closed"}
            </div>
          ) : isCreator ? (
            <div className="rdm-buy-disabled">
              {displayData?.name ? <b>{displayData.name}</b> : "This raffle"} can’t be entered by its creator.
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <div
                style={{
                  filter: blurBuy ? "blur(3px)" : undefined,
                  opacity: blurBuy ? 0.65 : 1,
                  pointerEvents: blurBuy ? "none" : "auto",
                  transition: "filter 0.2s ease, opacity 0.2s ease",
                }}
              >
                <div className="rdm-balance-row">
                  <span>Bal: {math.fmtUsdc(state.usdcBal?.toString() || "0")} USDC</span>
                  <span>Max: {math.maxBuy} Tickets</span>
                </div>

                {showRemainingNote && (
                  <div style={{ textAlign: "center", fontSize: 11, fontWeight: 800, color: "#9a3412", marginBottom: 10 }}>
                    Only {(math as any).remainingTickets} ticket{(math as any).remainingTickets === 1 ? "" : "s"} remaining
                  </div>
                )}

                {showBalanceWarn && (
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 12,
                      fontWeight: 900,
                      color: "#9a3412",
                      background: "#fff7ed",
                      border: "1px solid #fed7aa",
                      borderRadius: 12,
                      padding: "10px 12px",
                      marginBottom: 10,
                    }}
                  >
                    Your wallet balance isn’t enough for this purchase.
                  </div>
                )}

                <div className="rdm-stepper">
                  <button
                    className="rdm-step-btn"
                    onClick={() => actions.setTickets(String(Math.max(1, clampedUiTicket - 1)))}
                    disabled={clampedUiTicket <= 1}
                  >
                    −
                  </button>

                  <div className="rdm-input-wrapper">
                    <input
                      className="rdm-amount"
                      inputMode="numeric"
                      value={String(clampedUiTicket)}
                      onChange={(e) => {
                        const v = clampTicketsUi(e.target.value);
                        actions.setTickets(String(Math.min(v, maxBuy)));
                      }}
                      placeholder="1"
                    />
                    <div className="rdm-cost-preview">Total: {math.fmtUsdc(math.totalCostU.toString())} USDC</div>
                  </div>

                  <button
                    className="rdm-step-btn"
                    onClick={() => actions.setTickets(String(Math.min(maxBuy, clampedUiTicket + 1)))}
                    disabled={clampedUiTicket >= maxBuy}
                  >
                    +
                  </button>
                </div>

                {!flags.hasEnoughAllowance ? (
                  <button className="rdm-cta approve" onClick={actions.approve} disabled={state.isPending}>
                    {state.isPending ? "Preparing..." : "1. Prepare Wallet"}
                  </button>
                ) : (
                  <button
                    className="rdm-cta buy"
                    onClick={actions.buy}
                    disabled={!flags.canBuy || state.isPending}
                    title={!flags.hasEnoughBalance ? "Not enough USDC balance" : undefined}
                  >
                    {state.isPending ? "Confirming..." : `Buy ${clampedUiTicket} Ticket${clampedUiTicket !== 1 ? "s" : ""}`}
                  </button>
                )}

                {state.buyMsg && (
                  <div style={{ textAlign: "center", marginTop: 10, fontSize: 12, color: "#D32F2F", fontWeight: 700 }}>
                    {state.buyMsg}
                  </div>
                )}
              </div>

              {blurBuy && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    padding: 16,
                    pointerEvents: "none",
                  }}
                >
                  <div
                    style={{
                      background: "rgba(15, 23, 42, 0.92)",
                      border: "1px solid rgba(255,255,255,.10)",
                      borderRadius: 14,
                      padding: "12px 14px",
                      color: "#e5e7eb",
                      fontWeight: 900,
                      textAlign: "center",
                      maxWidth: 320,
                    }}
                  >
                    Sign in with your wallet to buy tickets.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* TABS */}
        <div className="rdm-tab-group">
          <button className={`rdm-tab-btn ${tab === "receipt" ? "active" : ""}`} onClick={() => setTab("receipt")}>
            Lifecycle
          </button>
          <button className={`rdm-tab-btn ${tab === "holders" ? "active" : ""}`} onClick={() => setTab("holders")}>
            Top Holders
          </button>
        </div>

        {/* TAB CONTENT */}
        <div className="rdm-scroll-content">
          {tab === "receipt" && (
            <div className="rdm-receipt">
              <div className="rdm-receipt-title" style={{ marginBottom: 16 }}>
                BLOCKCHAIN JOURNEY
              </div>

              <div className="rdm-timeline">
                {timeline.map((step, i) => (
                  <div key={i} className={`rdm-tl-item ${step.status}`}>
                    <div className="rdm-tl-dot" />
                    <div className="rdm-tl-title">{step.label}</div>
                    <div className="rdm-tl-date">
                      {formatDate(step.date)} <TxLink hash={step.tx} />
                    </div>
                    {step.winner && (
                      <div className="rdm-tl-winner-box">
                        <span>🏆 Winner:</span> <ExplorerLink addr={step.winner} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "holders" && (
            <div className="rdm-leaderboard-section">
              <div className="rdm-lb-header">
                <span>Address</span>
                <span>Holdings</span>
              </div>
              <div className="rdm-lb-list">
                {loadingPart && <div className="rdm-lb-empty">Loading holders...</div>}
                {!loadingPart && participants.length === 0 && <div className="rdm-lb-empty">No tickets sold yet.</div>}
                {!loadingPart &&
                  participants.map((p, i) => (
                    <div key={i} className="rdm-lb-row">
                      <span className="rdm-lb-addr">
                        <ExplorerLink addr={p.buyer} />
                      </span>
                      <div className="rdm-lb-stats">
                        <span className="rdm-lb-count">{p.ticketsPurchased} 🎟</span>{" "}
                        <span className="rdm-lb-pct">({p.percentage}%)</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}