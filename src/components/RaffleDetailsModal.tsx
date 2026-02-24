// src/components/RaffleDetailsModal.tsx
import { useState, useEffect, useMemo } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useRaffleInteraction } from "../hooks/useRaffleInteraction";
import { useRaffleParticipants } from "../hooks/useRaffleParticipants";
import { fetchRaffleMetadata, type RaffleListItem } from "../indexer/subgraph";
import "./RaffleDetailsModal.css";

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

  const displayData = (state.data || initialRaffle || metadata) as any;

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
  const effectiveMaxBuy = Number.isFinite(affordableMaxBuy)
    ? Math.max(0, Math.min(remainingCap, affordableMaxBuy))
    : remainingCap;

  const uiMaxForStepper = Math.max(1, effectiveMaxBuy);
  const uiTicket = clampTicketsUi(state.tickets);
  const clampedUiTicket = Math.min(uiTicket, uiMaxForStepper);

  useEffect(() => {
    if (!open || !raffleId) return;
    if (String(clampedUiTicket) !== String(state.tickets)) {
      actions.setTickets(String(clampedUiTicket));
    }
  }, [open, raffleId, uiMaxForStepper]);

  if (!open) return null;

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
    if (st === "CANCELED") return "This raffle is canceled.";
    if (st === "COMPLETED") return "This raffle is completed.";
    if (st === "DRAWING") return "Winner selection is in progress.";
    if (!minReached) {
      if (minTicketsN <= 0) return "A winner will be selected at the deadline.";
      return `Not enough tickets yet. If the minimum (${minTicketsN}) isn’t reached before the deadline, it will likely be canceled.`;
    }
    if (hasMax) {
      return `Winner selected at deadline — or if the remaining ${remaining ?? 0} tickets sell out.`;
    }
    return "A winner will be selected at the deadline.";
  })();

  return (
    <div className="rdm-overlay" onMouseDown={onClose}>
      <div className="rdm-card" onMouseDown={(e) => e.stopPropagation()}>
        {/* ✅ Physical Notches at the tear line */}
        <div className="rdm-notch left" />
        <div className="rdm-notch right" />

        {/* --- TOP: Ticket Body (Pink/Gradient) --- */}
        <div className="rdm-ticket-body">
          <div className="rdm-header">
            <button className="rdm-icon-btn" onClick={actions.handleShare} title="Copy Link">
              🔗
            </button>
            <div className="rdm-ticket-id">
              TICKET #{raffleId?.slice(2, 8).toUpperCase()}
            </div>
            <button className="rdm-icon-btn" onClick={onClose}>
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
                <span>Created by</span>
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

        {/* ✅ Perforation Line */}
        <div className="rdm-perforation-line" />

        {/* --- BOTTOM: Ticket Stub (Paper) --- */}
        <div className="rdm-ticket-stub">
          {/* BUY SECTION */}
          <div className="rdm-buy-section">
            {!flags.raffleIsOpen ? (
              <div className="rdm-closed-msg">
                {state.displayStatus === "Finalizing" ? "Raffle is finalizing..." : "Raffle Closed"}
              </div>
            ) : isCreator ? (
              <div className="rdm-buy-disabled">
                Creator cannot participate.
              </div>
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

                {showBalanceWarn && (
                  <div className="rdm-warn-box">
                    Insufficient balance.
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
                  <button
                    className="rdm-cta primary"
                    onClick={actions.buy}
                    disabled={!flags.canBuy || state.isPending}
                  >
                    {state.isPending ? "Processing..." : `Buy ${clampedUiTicket} Ticket${clampedUiTicket !== 1 ? "s" : ""}`}
                  </button>
                )}

                {state.buyMsg && <div className="rdm-error-msg">{state.buyMsg}</div>}

                {blurBuy && (
                  <div className="rdm-overlay-msg">
                    <span>Connect Wallet to Buy</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* DETAILS (RESTORED & ADDED MIN REQUIRED) */}
          <div className="rdm-dist-section">
            <div className="rdm-dist-header">Raffle Specs</div>
            <div className="rdm-dist-note">{expectedOutcome}</div>

            <div className="rdm-specs-grid">
              <div className="rdm-spec-row">
                <span>Status</span> <b>{prettyStatus(displayData?.status)}</b>
              </div>
              {/* ✅ ADDED: Explicitly show Min Required to explain potential cancellation */}
              <div className="rdm-spec-row">
                <span>Min Required</span> <b>{minTicketsN > 0 ? minTicketsN.toLocaleString("en-US") : "None"}</b>
              </div>
              <div className="rdm-spec-row">
                <span>Sold / Max</span> <b>{soldNow} / {hasMax ? maxTicketsN : "∞"}</b>
              </div>
              <div className="rdm-spec-row">
                <span>Deadline</span> <b>{formatDate(displayData?.deadline || "0")}</b>
              </div>
              
              {/* ✅ ADDED: Progress to minimum if relevant */}
              {!minReached && minTicketsN > 0 && (
                <div className="rdm-spec-row">
                  <span>Progress to Min</span>
                  <b>{soldNow.toLocaleString("en-US")} / {minTicketsN.toLocaleString("en-US")}</b>
                </div>
              )}
            </div>
          </div>

          {/* DISTRIBUTION (RESTORED as "Payout Slip") */}
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

          {/* TABS (Receipt Style) */}
          <div className="rdm-tabs">
            <button className={`rdm-tab ${tab === "receipt" ? "active" : ""}`} onClick={() => setTab("receipt")}>
              Receipt Log
            </button>
            <button className={`rdm-tab ${tab === "holders" ? "active" : ""}`} onClick={() => setTab("holders")}>
              Holders
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
                          <div className="rdm-winner-hl">Winner: {<ExplorerLink addr={step.winner} label={step.winner.slice(0,6)+'...'} />}</div>
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
                {loadingPart ? (
                  <div className="rdm-empty">Loading...</div>
                ) : participants.length === 0 ? (
                  <div className="rdm-empty">No tickets sold.</div>
                ) : (
                  participants.map((p, i) => (
                    <div key={i} className="rdm-holder-row">
                      <ExplorerLink addr={p.buyer} />
                      <b>{p.ticketsPurchased} ({p.percentage}%)</b>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
