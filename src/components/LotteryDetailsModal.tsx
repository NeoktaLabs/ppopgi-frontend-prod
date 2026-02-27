// src/components/LotteryDetailsModal.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useLotteryInteraction } from "../hooks/useLotteryInteraction";
import { useLotteryParticipants } from "../hooks/useLotteryParticipants";
import { fetchLotteryById, type LotteryListItem } from "../indexer/subgraph";

import "./LotteryDetailsModal.css";

const ExplorerLink = ({ addr, label }: { addr: string; label?: string }) => {
  if (!addr || addr === "0x0000000000000000000000000000000000000000") return <span>{label || "—"}</span>;
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
  const n = Number(ts);
  if (!ts || ts === "0" || !Number.isFinite(n) || n <= 0) return "—";
  return new Date(n * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}

/**
 * ✅ Indexer-based timeline (typed entities from your schema)
 */
type JourneyBundle = {
  lottery: {
    id: string;
    createdAt?: string | null;
    deployedAt?: string | null;
    deployedTx?: string | null;
    registeredAt?: string | null;
    deadline?: string | null;
    status?: any;
    winner?: string | null;
    drawingRequestedAt?: string | null;
    entropyRequestId?: string | null;
    canceledAt?: string | null;
    cancelReason?: string | null;
  } | null;

  funding: { timestamp: string; txHash: string } | null;
  finalized: { timestamp: string; txHash: string; requestId?: string | null } | null;
  winnerPicked: { timestamp: string; txHash: string; winner?: string | null; winningTicketIndex?: string | null } | null;
  canceled: { timestamp: string; txHash: string; reason?: string | null } | null;
};

async function fetchLotteryJourney(lotteryId: string): Promise<JourneyBundle | null> {
  const url = mustEnv("VITE_SUBGRAPH_URL");

  const query = `
    query LotteryJourney($id: ID!) {
      lottery(id: $id) {
        id
        createdAt
        deployedAt
        deployedTx
        registeredAt
        deadline
        status
        winner
        drawingRequestedAt
        entropyRequestId
        canceledAt
        cancelReason
      }

      fundingConfirmedEvents(
        first: 1
        orderBy: timestamp
        orderDirection: asc
        where: { lottery: $id }
      ) {
        timestamp
        txHash
      }

      lotteryFinalizedEvents(
        first: 1
        orderBy: timestamp
        orderDirection: asc
        where: { lottery: $id }
      ) {
        timestamp
        txHash
        requestId
      }

      winnerPickedEvents(
        first: 1
        orderBy: timestamp
        orderDirection: asc
        where: { lottery: $id }
      ) {
        timestamp
        txHash
        winner
        winningTicketIndex
      }

      lotteryCanceledEvents(
        first: 1
        orderBy: timestamp
        orderDirection: asc
        where: { lottery: $id }
      ) {
        timestamp
        txHash
        reason
      }
    }
  `;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { id: lotteryId.toLowerCase() },
      }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || json?.errors?.length) return null;

    const lot = json?.data?.lottery ?? null;

    const funding0 = json?.data?.fundingConfirmedEvents?.[0] ?? null;
    const fin0 = json?.data?.lotteryFinalizedEvents?.[0] ?? null;
    const win0 = json?.data?.winnerPickedEvents?.[0] ?? null;
    const canc0 = json?.data?.lotteryCanceledEvents?.[0] ?? null;

    const bundle: JourneyBundle = {
      lottery: lot
        ? {
            id: String(lot.id),
            createdAt: lot.createdAt != null ? String(lot.createdAt) : null,
            deployedAt: lot.deployedAt != null ? String(lot.deployedAt) : null,
            deployedTx: lot.deployedTx != null ? String(lot.deployedTx).toLowerCase() : null,
            registeredAt: lot.registeredAt != null ? String(lot.registeredAt) : null,
            deadline: lot.deadline != null ? String(lot.deadline) : null,
            status: lot.status,
            winner: lot.winner != null ? String(lot.winner).toLowerCase() : null,
            drawingRequestedAt: lot.drawingRequestedAt != null ? String(lot.drawingRequestedAt) : null,
            entropyRequestId: lot.entropyRequestId != null ? String(lot.entropyRequestId) : null,
            canceledAt: lot.canceledAt != null ? String(lot.canceledAt) : null,
            cancelReason: lot.cancelReason != null ? String(lot.cancelReason) : null,
          }
        : null,

      funding: funding0
        ? { timestamp: String(funding0.timestamp ?? "0"), txHash: String(funding0.txHash ?? "").toLowerCase() }
        : null,

      finalized: fin0
        ? {
            timestamp: String(fin0.timestamp ?? "0"),
            txHash: String(fin0.txHash ?? "").toLowerCase(),
            requestId: fin0.requestId != null ? String(fin0.requestId) : null,
          }
        : null,

      winnerPicked: win0
        ? {
            timestamp: String(win0.timestamp ?? "0"),
            txHash: String(win0.txHash ?? "").toLowerCase(),
            winner: win0.winner != null ? String(win0.winner).toLowerCase() : null,
            winningTicketIndex: win0.winningTicketIndex != null ? String(win0.winningTicketIndex) : null,
          }
        : null,

      canceled: canc0
        ? {
            timestamp: String(canc0.timestamp ?? "0"),
            txHash: String(canc0.txHash ?? "").toLowerCase(),
            reason: canc0.reason != null ? String(canc0.reason) : null,
          }
        : null,
    };

    return bundle;
  } catch {
    return null;
  }
}

type Props = {
  open: boolean;
  lotteryId: string | null;
  onClose: () => void;
  initialLottery?: LotteryListItem | null;
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

function prettyStatus(s: any) {
  const v = String(s || "").toUpperCase().trim();
  if (v === "OPEN") return "Open";
  if (v === "FUNDING_PENDING") return "Getting ready";
  if (v === "DRAWING") return "Drawing";
  if (v === "COMPLETED") return "Completed";
  if (v === "CANCELED") return "Canceled";
  if (v) return v.charAt(0) + v.slice(1).toLowerCase();
  return "Unknown";
}

function participantAddr(p: any): string {
  return String(p?.buyer || p?.user || p?.address || p?.account || "").toLowerCase();
}

export function LotteryDetailsModal({ open, lotteryId, onClose, initialLottery }: Props) {
  const { state, math, flags, actions } = useLotteryInteraction(lotteryId, open);
  const account = useActiveAccount();

  const [tab, setTab] = useState<"receipt" | "holders" | "ranges">("receipt");
  const [metadata, setMetadata] = useState<Partial<LotteryListItem> | null>(null);
  const [journey, setJourney] = useState<JourneyBundle | null>(null);

  const handleClose = useCallback(() => {
    try {
      actions.clearLastBuy?.();
    } catch {}
    onClose();
  }, [actions, onClose]);

  useEffect(() => {
    if (!lotteryId || !open) {
      setMetadata(null);
      setJourney(null);
      setTab("receipt");
      return;
    }

    if ((initialLottery as any)?.createdAtTimestamp) setMetadata(initialLottery as any);

    let active = true;

    if (!(initialLottery as any)?.createdAtTimestamp) {
      fetchLotteryById(lotteryId).then((data) => {
        if (active && data) setMetadata(data as any);
      });
    }

    fetchLotteryJourney(lotteryId).then((b) => {
      if (!active) return;
      setJourney(b);
    });

    return () => {
      active = false;
    };
  }, [lotteryId, open, initialLottery]);

  const displayData = (state.data || initialLottery || metadata) as any;

  const soldForPct = Number(displayData?.sold || 0);
  const { participants, isLoading: loadingPart } = useLotteryParticipants(lotteryId, soldForPct);

  const timeline = useMemo(() => {
    if (!displayData && !journey?.lottery) return [];

    const lot = journey?.lottery ?? null;

    const createdAt =
      lot?.createdAt ||
      displayData?.createdAt ||
      displayData?.createdAtTimestamp ||
      displayData?.history?.createdAt ||
      lot?.deployedAt ||
      displayData?.deployedAt ||
      null;

    const deployedTx = lot?.deployedTx || displayData?.deployedTx || displayData?.creationTx || null;
    const registeredAt = lot?.registeredAt || displayData?.registeredAt || displayData?.history?.registeredAt || null;
    const deadline = lot?.deadline || displayData?.deadline || null;

    const statusRaw = displayData?.status ?? lot?.status ?? null;
    const status = String(statusRaw ?? "").toUpperCase();

    const funding = journey?.funding ?? null;
    const finalized = journey?.finalized ?? null;
    const winnerPicked = journey?.winnerPicked ?? null;
    const canceled = journey?.canceled ?? null;

    const steps: any[] = [];

    steps.push({ label: "Initialized", date: createdAt, tx: deployedTx, status: createdAt ? "done" : "active" });
    steps.push({ label: "Registered", date: registeredAt, tx: null, status: registeredAt ? "done" : "future" });

    if (funding) {
      steps.push({ label: "Ticket Sales Open", date: funding.timestamp, tx: funding.txHash, status: "done" });
    } else {
      const s = status === "OPEN" || status === "DRAWING" || status === "COMPLETED" || status === "CANCELED" ? "active" : "future";
      steps.push({ label: "Ticket Sales Open", date: null, tx: null, status: s });
    }

    if (finalized) {
      steps.push({ label: "Randomness Requested", date: finalized.timestamp, tx: finalized.txHash, status: "done" });
    } else if (status === "DRAWING") {
      steps.push({ label: "Randomness Requested", date: null, tx: null, status: "active" });
    } else {
      steps.push({ label: "Draw Deadline", date: deadline, tx: null, status: status === "OPEN" ? "active" : "future" });
    }

    if (winnerPicked) {
      steps.push({
        label: "Winner Selected",
        date: winnerPicked.timestamp,
        tx: winnerPicked.txHash,
        status: "done",
        winner: winnerPicked.winner || displayData?.winner || lot?.winner || null,
      });
    } else if (canceled) {
      steps.push({ label: "Canceled", date: canceled.timestamp, tx: canceled.txHash, status: "done" });
    } else if (status === "COMPLETED") {
      steps.push({
        label: "Winner Selected",
        date: lot?.drawingRequestedAt || displayData?.completedAt || null,
        tx: null,
        status: "done",
        winner: displayData?.winner || lot?.winner || null,
      });
    } else if (status === "CANCELED") {
      steps.push({ label: "Canceled", date: lot?.canceledAt || displayData?.canceledAt || null, tx: null, status: "done" });
    } else {
      steps.push({ label: "Settlement", date: null, tx: null, status: "future" });
    }

    return steps;
  }, [displayData, journey]);

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
    const isCanceled = status === "CANCELED";

    const pot = parseFloat(math.fmtUsdc(displayData.winningPot || "0"));
    const sold = Number(displayData.sold || 0);
    const ticketPrice = parseFloat(math.fmtUsdc(displayData.ticketPrice || "0"));
    const grossSales = ticketPrice * sold;

    const winnerNet = pot * 0.9;
    const platformPrizeFee = pot * 0.1;

    const creatorNet = grossSales * 0.9;
    const platformSalesFee = grossSales * 0.1;

    return { isCanceled, winnerNet, platformPrizeFee, creatorNet, platformSalesFee };
  }, [displayData, math]);

  const creatorAddr = String(displayData?.creator || "").toLowerCase();
  const meAddr = String(account?.address || "").toLowerCase();
  const isCreator = !!creatorAddr && !!meAddr && creatorAddr === meAddr;

  const ticketPriceU = (() => {
    try {
      return BigInt(displayData?.ticketPrice || "0");
    } catch {
      return 0n;
    }
  })();

  const affordableMaxBuy = useMemo(() => {
    if (!state.usdcBal || ticketPriceU <= 0n) return Number.POSITIVE_INFINITY;
    const max = state.usdcBal / ticketPriceU;
    const capped = max > 10_000n ? 10_000 : Number(max);
    return Math.max(0, capped);
  }, [state.usdcBal, ticketPriceU]);

  const remainingCap = Math.max(0, Number(math.maxBuy || 0));
  const effectiveMaxBuy = Number.isFinite(affordableMaxBuy) ? Math.max(0, Math.min(remainingCap, affordableMaxBuy)) : remainingCap;

  const uiMaxForStepper = Math.max(1, effectiveMaxBuy);
  const uiTicket = clampTicketsUi(state.tickets);
  const clampedUiTicket = Math.min(uiTicket, uiMaxForStepper);

  useEffect(() => {
    if (!open || !lotteryId) return;
    if (String(clampedUiTicket) !== String(state.tickets)) actions.setTickets(String(clampedUiTicket));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lotteryId, uiMaxForStepper]);

  // Optional UX: when success appears, keep tab stable (no impact on hooks)
  useEffect(() => {
    if (!open) return;
    if (state.lastBuy) setTab("receipt");
  }, [open, state.lastBuy]);

  const createdOnTs = timeline?.[0]?.date ?? null;
  const showRemainingNote = typeof (math as any).remainingTickets === "number" && (math as any).remainingTickets > 0;

  const blurBuy = !state.isConnected;
  const showBalanceWarn = state.isConnected && flags.hasEnoughAllowance && !flags.hasEnoughBalance;

  const soldNow = Number(displayData?.sold || 0);
  const minTicketsN = Math.max(0, Number(displayData?.minTickets || 0));
  const maxTicketsN = Math.max(0, Number(displayData?.maxTickets || 0));
  const hasMax = maxTicketsN > 0;
  const remaining = hasMax ? Math.max(0, maxTicketsN - soldNow) : null;
  const minReached = minTicketsN > 0 ? soldNow >= minTicketsN : true;

  const expectedOutcome = (() => {
    const st = String(displayData?.status || "").toUpperCase();
    if (st === "CANCELED") return "This lottery is canceled.";
    if (st === "COMPLETED") return "This lottery is completed.";
    if (st === "DRAWING") return "Winner selection is in progress.";
    if (!minReached) {
      if (minTicketsN <= 0) return "A winner will be selected at the deadline.";
      return `Not enough tickets yet. If the minimum (${minTicketsN}) isn’t reached before the deadline, it will likely be canceled.`;
    }
    if (hasMax) return `Winner selected at deadline — or if the remaining ${remaining ?? 0} tickets sell out.`;
    return "A winner will be selected at the deadline.";
  })();

  const showRangePanel =
    state.rangeCount != null ||
    state.maxRanges != null ||
    state.rangeTier != null ||
    state.minCostToCreateNewRange != null ||
    state.wouldCreateRange != null;

  const tierLabel = state.rangeTier != null && state.rangeTier >= 0 ? `Tier ${state.rangeTier + 1}` : "Tier —";

  const fmtCostTickets = (raw?: bigint | null) => {
    if (raw == null) return "—";
    if (ticketPriceU <= 0n) return "—";
    const tix = raw / ticketPriceU;
    return `${tix.toString()} ticket${tix === 1n ? "" : "s"}`;
  };

  const nextTierText = (() => {
    if (state.rangesUntilNextTier == null) return null;
    if (state.rangesUntilNextTier <= 0) return "Next tier is active now.";
    return `${state.rangesUntilNextTier} range${state.rangesUntilNextTier === 1 ? "" : "s"} until next tier`;
  })();

  const minBuyHint = (() => {
    if (!state.wouldCreateRange) return null;
    const n = Number(state.minTicketsForNewRange || 1);
    return `Your next buy will open a new range. Minimum is ${n} ticket${n === 1 ? "" : "s"}.`;
  })();

  const soldEffective = useMemo(() => {
    const base = Number(displayData?.sold || 0);
    const add = state.lastBuy?.count || 0;
    return Math.max(base, base + add);
  }, [displayData?.sold, state.lastBuy?.count]);

  const successOdds = useMemo(() => {
    if (soldEffective <= 0) return "100%";
    return clampPct(100 / soldEffective);
  }, [soldEffective]);

  const showSuccess = !!state.lastBuy;

  return !open ? null : (
    <div className="rdm-overlay" onMouseDown={handleClose}>
      <div className="rdm-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="rdm-notch left" />
        <div className="rdm-notch right" />

        <div className="rdm-ticket-body">
          <div className="rdm-header">
            <button className="rdm-icon-btn" onClick={actions.handleShare} title="Copy Link">
              🔗
            </button>
            <div className="rdm-ticket-id">TICKET #{lotteryId?.slice(2, 8).toUpperCase()}</div>
            <button className="rdm-icon-btn" onClick={handleClose}>
              ✕
            </button>
          </div>

          <div className="rdm-hero">
            <div className="rdm-hero-lbl">Prize Pool</div>
            <div className="rdm-hero-val">
              {math.fmtUsdc(displayData?.winningPot || "0")} <span className="rdm-hero-unit">USDC</span>
            </div>

            <div className="rdm-hero-meta">
              <div className="rdm-host">
                <span>Created by </span>
                <ExplorerLink addr={String(displayData?.creator || "")} label={math.short(String(displayData?.creator || ""))} />
              </div>
              <div className="rdm-createdon">
                <span>on</span>
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
                <div className="rdm-sb-lbl">Price</div>
                <div className="rdm-sb-val">
                  {stats.price} <span style={{ fontSize: 10, opacity: 0.7 }}>USDC</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rdm-perforation-line" />

        <div className="rdm-ticket-stub">
          {showSuccess && state.lastBuy ? (
            <div className="rdm-success">
              <div className="rdm-success-icon">✓</div>
              <div className="rdm-success-title">Tickets Purchased!</div>
              <div className="rdm-success-sub">
                You bought <b>{state.lastBuy.count}</b> ticket{state.lastBuy.count === 1 ? "" : "s"}.
              </div>

              <div className="rdm-success-grid">
                <div className="rdm-success-box">
                  <div className="rdm-success-lbl">You spent</div>
                  <div className="rdm-success-val">{math.fmtUsdc(state.lastBuy.totalCostU.toString())} USDC</div>
                </div>

                <div className="rdm-success-box">
                  <div className="rdm-success-lbl">Current win odds</div>
                  <div className="rdm-success-val">{successOdds}</div>
                  <div className="rdm-success-note">Odds change as tickets sell</div>
                </div>

                <div className="rdm-success-box">
                  <div className="rdm-success-lbl">Ends at</div>
                  <div className="rdm-success-val">{formatDate(displayData?.deadline || "0")}</div>
                  {hasMax && <div className="rdm-success-note">May end earlier if sold out</div>}
                </div>

                <div className="rdm-success-box">
                  <div className="rdm-success-lbl">Sold / Max</div>
                  <div className="rdm-success-val">
                    {soldEffective} / {hasMax ? maxTicketsN : "∞"}
                  </div>
                  {hasMax && remaining != null && <div className="rdm-success-note">{remaining} remaining</div>}
                </div>
              </div>

              <div className="rdm-success-actions">
                {state.lastBuy.txHash && (
                  <a
                    className="rdm-cta"
                    href={`https://explorer.etherlink.com/tx/${state.lastBuy.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View Tx ↗
                  </a>
                )}

                <button className="rdm-cta" onClick={handleClose}>
                  Close
                </button>

                <button
                  className="rdm-cta primary"
                  onClick={() => {
                    actions.clearLastBuy();
                    setTab("receipt");
                  }}
                >
                  Buy more
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="rdm-buy-section">
                {!flags.lotteryIsOpen ? (
                  <div className="rdm-closed-msg">
                    {state.displayStatus === "Finalizing" ? "Lottery is finalizing..." : "Lottery Closed"}
                  </div>
                ) : isCreator ? (
                  <div className="rdm-buy-disabled">Creator cannot participate.</div>
                ) : (
                  <div className={`rdm-buy-inner ${blurBuy ? "blurred" : ""}`}>
                    <div className="rdm-balance-row">
                      <span>Bal: {math.fmtUsdc(state.usdcBal?.toString() || "0")} USDC</span>
                      <span>Cap: {uiMaxForStepper}</span>
                    </div>

                    {showRemainingNote && (
                      <div className="rdm-warn-text">
                        Only {(math as any).remainingTickets} ticket{(math as any).remainingTickets === 1 ? "" : "s"} remaining
                      </div>
                    )}

                    {minBuyHint && <div className="rdm-warn-text">{minBuyHint}</div>}

                    {showBalanceWarn && <div className="rdm-warn-box">Insufficient balance.</div>}

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
                            actions.setTickets(String(Math.min(v, uiMaxForStepper)));
                          }}
                          placeholder="1"
                        />
                        <div className="rdm-cost-preview">Total: {math.fmtUsdc(math.totalCostU.toString())} USDC</div>
                      </div>

                      <button
                        className="rdm-step-btn"
                        onClick={() => actions.setTickets(String(Math.min(uiMaxForStepper, clampedUiTicket + 1)))}
                        disabled={clampedUiTicket >= uiMaxForStepper}
                      >
                        +
                      </button>
                    </div>

                    {!flags.hasEnoughAllowance ? (
                      <button className="rdm-cta primary" onClick={actions.approve} disabled={state.isPending}>
                        {state.isPending ? "Preparing..." : "1. Prepare Wallet"}
                      </button>
                    ) : (
                      <button className="rdm-cta primary" onClick={actions.buy} disabled={!flags.canBuy || state.isPending}>
                        {state.isPending ? "Processing..." : `Buy ${clampedUiTicket} Ticket${clampedUiTicket !== 1 ? "s" : ""}`}
                      </button>
                    )}

                    {/* ✅ Removed state.buyMsg rendering entirely — rely on button states + success screen */}
                    {blurBuy && (
                      <div className="rdm-overlay-msg">
                        <span>Connect Wallet to Buy</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="rdm-dist-section">
                <div className="rdm-dist-header">Lottery Specs</div>
                <div className="rdm-dist-note">{expectedOutcome}</div>

                <div className="rdm-specs-grid">
                  <div className="rdm-spec-row">
                    <span>Status</span> <b>{prettyStatus(displayData?.status)}</b>
                  </div>

                  <div className="rdm-spec-row">
                    <span>Min Required</span> <b>{minTicketsN > 0 ? minTicketsN.toLocaleString("en-US") : "None"}</b>
                  </div>

                  <div className="rdm-spec-row">
                    <span>Sold / Max</span>{" "}
                    <b>
                      {soldNow} / {hasMax ? maxTicketsN : "∞"}
                    </b>
                  </div>

                  <div className="rdm-spec-row">
                    <span>Deadline</span> <b>{formatDate(displayData?.deadline || "0")}</b>
                  </div>

                  {!minReached && minTicketsN > 0 && (
                    <div className="rdm-spec-row">
                      <span>Progress to Min</span>
                      <b>
                        {soldNow.toLocaleString("en-US")} / {minTicketsN.toLocaleString("en-US")}
                      </b>
                    </div>
                  )}
                </div>
              </div>

              {distribution && (
                <div className="rdm-dist-section">
                  <div className="rdm-dist-header">Payout Distribution</div>
                  {distribution.isCanceled ? (
                    <div className="rdm-dist-note warn">Canceled. Reclaim available on dashboard.</div>
                  ) : (
                    <div className="rdm-payout-slip">
                      <div className="rdm-slip-row head">
                        <span>Prize Breakdown</span>
                      </div>
                      <div className="rdm-slip-row">
                        <span>Winner (Net)</span> <span>{fmtNum(distribution.winnerNet)} USDC</span>
                      </div>
                      <div className="rdm-slip-row">
                        <span>Fee</span> <span>{fmtNum(distribution.platformPrizeFee)} USDC</span>
                      </div>

                      <div className="rdm-slip-divider" />

                      <div className="rdm-slip-row head" style={{ marginTop: 8 }}>
                        <span>Sales Breakdown</span>
                      </div>
                      <div className="rdm-slip-row">
                        <span>Creator (Net)</span> <span>{fmtNum(distribution.creatorNet)} USDC</span>
                      </div>
                      <div className="rdm-slip-row">
                        <span>Fee</span> <span>{fmtNum(distribution.platformSalesFee)} USDC</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="rdm-tabs">
                <button className={`rdm-tab ${tab === "receipt" ? "active" : ""}`} onClick={() => setTab("receipt")}>
                  Receipt Log
                </button>
                <button className={`rdm-tab ${tab === "holders" ? "active" : ""}`} onClick={() => setTab("holders")}>
                  Holders
                </button>
                <button className={`rdm-tab ${tab === "ranges" ? "active" : ""}`} onClick={() => setTab("ranges")}>
                  Ranges
                </button>
              </div>

              <div className="rdm-tab-content">
                {tab === "receipt" && (
                  <div className="rdm-receipt">
                    <div className="rdm-receipt-line start">--- START OF LOG ---</div>
                    {timeline.map((step, i) => (
                      <div key={i} className={`rdm-tl-row ${step.status}`}>
                        <div className="rdm-tl-time">{step.date ? formatDate(step.date).split(",")[0] : "--/--"}</div>
                        <div className="rdm-tl-desc">
                          <div className="rdm-tl-label">{step.label}</div>
                          <div className="rdm-tl-sub">
                            {step.tx && <TxLink hash={step.tx} />}
                            {step.winner && (
                              <div className="rdm-winner-hl">
                                Winner: <ExplorerLink addr={step.winner} label={String(step.winner).slice(0, 6) + "..."} />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="rdm-receipt-line end">--- END OF LOG ---</div>
                  </div>
                )}

                {tab === "holders" && (
                  <div className="rdm-holders">
                    {loadingPart && participants.length === 0 ? (
                      <div className="rdm-empty">Loading...</div>
                    ) : participants.length === 0 ? (
                      <div className="rdm-empty">No tickets sold.</div>
                    ) : (
                      participants.map((p, i) => {
                        const addr = participantAddr(p);
                        return (
                          <div key={i} className="rdm-holder-row">
                            <ExplorerLink addr={addr} />
                            <b>
                              {(p as any).ticketsPurchased} ({(p as any).percentage}%)
                            </b>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {tab === "ranges" && (
                  <div className="rdm-receipt">
                    <div className="rdm-receipt-line start">--- RANGE POLICY ---</div>

                    {!showRangePanel ? (
                      <div className="rdm-empty">Range information unavailable.</div>
                    ) : (
                      <>
                        <div className="rdm-slip-row">
                          <span>Current tier</span>
                          <span>
                            <b>{tierLabel}</b>
                            {state.isNearTierUp ? <span style={{ marginLeft: 8 }}>⚠️</span> : null}
                          </span>
                        </div>

                        <div className="rdm-slip-row">
                          <span>Ranges used</span>
                          <span>
                            <b>
                              {state.rangeCount ?? "—"} / {state.maxRanges ?? "—"}
                            </b>
                            {state.rangeCapacityPct != null ? (
                              <span style={{ marginLeft: 8, opacity: 0.75 }}>({state.rangeCapacityPct.toFixed(0)}%)</span>
                            ) : null}
                          </span>
                        </div>

                        <div className="rdm-slip-row">
                          <span>Tier progress</span>
                          <span>
                            {state.rangesUntilNextTier != null ? <b>{nextTierText}</b> : <b>—</b>}
                            {state.rangeTierProgressPct != null ? (
                              <span style={{ marginLeft: 8, opacity: 0.75 }}>({state.rangeTierProgressPct.toFixed(0)}%)</span>
                            ) : null}
                          </span>
                        </div>

                        <div className="rdm-slip-divider" />

                        <div className="rdm-slip-row head">
                          <span>Buying rules</span>
                        </div>

                        <div className="rdm-slip-row">
                          <span>Your next buy opens new range?</span>
                          <span>
                            <b>{state.wouldCreateRange == null ? "—" : state.wouldCreateRange ? "Yes" : "No"}</b>
                          </span>
                        </div>

                        <div className="rdm-slip-row">
                          <span>Min tickets (if opening range)</span>
                          <span>
                            <b>{state.wouldCreateRange ? state.minTicketsForNewRange : "—"}</b>
                          </span>
                        </div>

                        <div className="rdm-slip-row">
                          <span>Min cost to open new range</span>
                          <span>
                            <b>{math.fmtUsdc(state.minCostToCreateNewRange?.toString() || "0")} USDC</b>
                            <span style={{ marginLeft: 8, opacity: 0.75 }}> (~{fmtCostTickets(state.minCostToCreateNewRange)})</span>
                          </span>
                        </div>

                        <div className="rdm-receipt-line end">--- END ---</div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}