// src/pages/DashboardPage.tsx
import { useState, useEffect, useMemo } from "react";
import { formatUnits } from "ethers";
import { RaffleCard } from "../components/RaffleCard";
import { RaffleCardSkeleton } from "../components/RaffleCardSkeleton";
import { useDashboardController } from "../hooks/useDashboardController";
import "./DashboardPage.css";


// Helpers
const fmt = (v: string, dec = 18) => {
  try {
    const val = formatUnits(BigInt(v || "0"), dec);
    return parseFloat(val).toLocaleString("en-US", { maximumFractionDigits: 2 });
  } catch {
    return "0";
  }
};

type Props = {
  account: string | null;
  onOpenRaffle: (id: string) => void;
  onOpenSafety: (id: string) => void;
};

type WithdrawMethod = "withdrawFunds" | "withdrawNative" | "claimTicketRefund";

function norm(a?: string | null) {
  return String(a || "").toLowerCase();
}

function shortAddr(a?: string | null, head = 6, tail = 4) {
  const s = String(a || "");
  if (!s) return "";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function DashboardPage({ account: accountProp, onOpenRaffle, onOpenSafety }: Props) {
  
  useEffect(() => {
  document.title = "Ppopgi 뽑기 — Dashboard";
}, []);
  
  const { data, actions, account: hookAccount } = useDashboardController();

  // ✅ Source of truth: hook account (fallback to prop)
  const account = hookAccount ?? accountProp;

  const [tab, setTab] = useState<"active" | "history" | "created">("active");
  const [copied, setCopied] = useState(false);

  // Clock
  const [nowS, setNowS] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowS(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const handleCopy = () => {
    if (!account) return;
    navigator.clipboard.writeText(account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // --- JOINED RAFFLES PROCESSING ---
  const { active: activeEntries, past: pastEntries } = useMemo(() => {
    const active: any[] = [];
    const past: any[] = [];

    if (!data.joined) return { active, past };

    data.joined.forEach((r: any) => {
      const tickets = Number(r.userTicketsOwned || 0);
      const sold = Math.max(0, Number(r.sold || 0));
      const percentage = sold > 0 ? ((tickets / sold) * 100).toFixed(1) : "0.0";

      const enriched = { ...r, userEntry: { count: tickets, percentage } };

      if (["OPEN", "FUNDING_PENDING", "DRAWING"].includes(r.status)) {
        active.push(enriched);
      } else {
        past.push(enriched);
      }
    });

    return { active, past };
  }, [data.joined]);

  const msgIsSuccess = useMemo(() => {
    if (!data.msg) return false;
    return /success|successful|claimed/i.test(data.msg);
  }, [data.msg]);

  // ✅ Refunds: always claimTicketRefund (two-phase refund logic)
  const getPrimaryMethod = (opts: {
    isRefund: boolean;
    hasUsdc: boolean;
    hasNative: boolean;
    ticketCount: number;
  }): WithdrawMethod | null => {
    const { isRefund, hasUsdc, hasNative, ticketCount } = opts;

    if (isRefund) return ticketCount > 0 ? "claimTicketRefund" : null;
    if (hasUsdc) return "withdrawFunds";
    if (hasNative) return "withdrawNative";
    return null;
  };

  const hasClaims = data.claimables.length > 0;

  // ✅ silent refresh UX: only show skeletons on true cold load
  const showColdSkeletons = data.isColdLoading && activeEntries.length === 0 && pastEntries.length === 0;

  return (
    <div className="db-container">
      {/* HERO */}
      <div className="db-hero">
        <div className="db-hero-content">
          <div className="db-avatar-circle">👤</div>
          <div>
            <div className="db-hero-label">Player Dashboard</div>

            {/* ✅ Short display on mobile, full copy on click */}
            <div className="db-hero-addr" onClick={handleCopy} title="Click to Copy">
              {account ? shortAddr(account, 8, 6) : "Not Connected"}
              {account && <span className="db-copy-icon">{copied ? "✅" : "📋"}</span>}
            </div>
          </div>
        </div>

        <div className="db-hero-stats">
          <div className="db-stat">
            <div className="db-stat-num">{activeEntries.length}</div>
            <div className="db-stat-lbl">On-going</div>
          </div>
          <div className="db-stat">
            <div className="db-stat-num">{pastEntries.length}</div>
            <div className="db-stat-lbl">Past</div>
          </div>
          {hasClaims && (
            <div className="db-stat highlight">
              <div className="db-stat-num">{data.claimables.length}</div>
              <div className="db-stat-lbl">To Claim</div>
            </div>
          )}
        </div>
      </div>

      {/* STATUS BANNER */}
      {data.msg && <div className={`db-msg-banner ${msgIsSuccess ? "success" : "error"}`}>{data.msg}</div>}

      {/* CLAIMABLES SECTION */}
      <div className="db-section claim-section">
        <div className="db-section-header">
          <div className="db-section-title">Claimables</div>
          {hasClaims && <span className="db-pill pulse">Action Required</span>}
        </div>

        {!hasClaims ? (
          <div className="db-empty-claims">
            <div style={{ fontSize: 24, marginBottom: 8 }}>🎉</div>
            <div>You’ve already claimed everything!</div>
          </div>
        ) : (
          <div className="db-grid">
            {data.claimables.map((it: any) => {
              const r = it.raffle;

              const acct = norm(account);
              const winner = norm(r.winner);
              const creator = norm(r.creator);

              const iAmWinner = !!acct && acct === winner;
              const iAmCreator = !!acct && acct === creator;

              const hasUsdc = BigInt(it.claimableUsdc || "0") > 0n;
              const hasNative = BigInt(it.claimableNative || "0") > 0n;

              const isRefund = it.type === "REFUND";
              const ticketCount = Number(it.userTicketsOwned || 0);

              const primaryMethod = getPrimaryMethod({ isRefund, hasUsdc, hasNative, ticketCount });

              // =========================================================
              // ✅ YOUR EXACT COPY RULES (with sane fallbacks)
              // =========================================================
              let badgeTitle = "Claim Available";
              let message = "Funds available to claim.";
              let primaryLabel = "Claim";

              if (isRefund) {
                badgeTitle = "Refund";
                message = "Raffle canceled — reclaim your ticket price.";
                primaryLabel = "Reclaim Refund";
              } else if (iAmWinner) {
                badgeTitle = "Winner";
                message = "You won!! Congratulations! Reclaim your prize now!";
                primaryLabel = "Claim Prize";
              } else if (iAmCreator) {
                badgeTitle = "Creator";
                message = "Reclaim your ticket price revenue.";
                primaryLabel = "Withdraw Revenue";
              } else {
                badgeTitle = "Claim";
                message = "Funds available to withdraw.";
                primaryLabel = hasUsdc ? "Claim USDC" : hasNative ? "Claim Native" : "Claim";
              }

              // For non-refund claimables, allow dual buttons if both are >0
              const showDual = !isRefund && hasUsdc && hasNative;

              return (
                <div key={r.id} className="db-claim-wrapper">
                  <RaffleCard raffle={r} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} nowMs={nowS * 1000} />

                  <div className="db-claim-box">
                    <div className="db-claim-header">
                      <span className={`db-claim-badge ${isRefund ? "refund" : "win"}`}>{badgeTitle}</span>
                    </div>

                    <div className="db-claim-text">
                      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, color: "#334155" }}>{message}</div>

                      {isRefund ? (
                        <div className="db-refund-layout">
                          <div className="db-refund-val">
                            Reclaim {ticketCount || "your"} ticket{ticketCount !== 1 ? "s" : ""}
                          </div>
                          {hasUsdc && (
                            <div className="db-refund-sub">
                              Expected: <b>{fmt(it.claimableUsdc, 6)} USDC</b>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="db-win-layout">
                          <div className="db-win-label">Available:</div>
                          <div className="db-win-val">
                            {hasUsdc && <span>{fmt(it.claimableUsdc, 6)} USDC</span>}
                            {hasNative && (
                              <span>
                                {hasUsdc ? " + " : ""}
                                {fmt(it.claimableNative, 18)} Native
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="db-claim-actions">
                      {showDual ? (
                        <>
                          <button
                            className="db-btn primary"
                            disabled={data.isPending}
                            onClick={() => actions.withdraw(r.id, "withdrawFunds")}
                          >
                            {data.isPending ? "Processing..." : "Claim USDC"}
                          </button>

                          <button
                            className="db-btn secondary"
                            disabled={data.isPending}
                            onClick={() => actions.withdraw(r.id, "withdrawNative")}
                          >
                            {data.isPending ? "Processing..." : "Claim Native"}
                          </button>
                        </>
                      ) : (
                        <button
                          className={`db-btn ${isRefund ? "secondary" : "primary"}`}
                          disabled={data.isPending || !primaryMethod}
                          onClick={() => primaryMethod && actions.withdraw(r.id, primaryMethod)}
                        >
                          {data.isPending ? "Processing..." : primaryLabel}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MY RAFFLES TITLE */}
      <div className="db-section-header">
        <div className="db-section-title">My Raffles</div>
      </div>

      {/* TABS */}
      <div className="db-tabs-container">
        <div className="db-tabs">
          <button className={`db-tab ${tab === "active" ? "active" : ""}`} onClick={() => setTab("active")}>
            On-going
          </button>
          <button className={`db-tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
            Past
          </button>
          <button className={`db-tab ${tab === "created" ? "active" : ""}`} onClick={() => setTab("created")}>
            Created
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <div className="db-grid-area">
        {tab === "active" && (
          <div className="db-grid">
            {/* ✅ skeleton only on cold load */}
            {showColdSkeletons && (
              <>
                <RaffleCardSkeleton />
                <RaffleCardSkeleton />
              </>
            )}

            {/* ✅ empty state only when not cold loading */}
            {!data.isColdLoading && activeEntries.length === 0 && <div className="db-empty">You have no on-going raffles.</div>}

            {/* ✅ show cards even if background refresh is happening */}
            {activeEntries.map((r: any) => (
              <RaffleCard
                key={r.id}
                raffle={r}
                onOpen={onOpenRaffle}
                onOpenSafety={onOpenSafety}
                nowMs={nowS * 1000}
                userEntry={r.userEntry}
              />
            ))}
          </div>
        )}

        {tab === "history" && (
          <div className="db-grid">
            {/* ✅ empty state only when not cold loading */}
            {!data.isColdLoading && pastEntries.length === 0 && <div className="db-empty">No past participation found.</div>}

            {pastEntries.map((r: any) => {
              const acct = norm(account);
              const winner = norm(r.winner);

              const participated = Number(r.userEntry?.count || 0) > 0;
              const completed = r.status === "COMPLETED";
              const canceled = r.status === "CANCELED";
              const iWon = completed && acct && winner === acct;

              // NOTE: This is only a UI badge. Actual claimability is handled in claimables.
              const isRefunded = canceled && Number(r.userEntry?.count || 0) === 0;

              // ✅ YOUR RULE: Settled + participated + not winner
              const iLost = completed && participated && !iWon;

              return (
                <div key={r.id} className="db-history-card-wrapper">
                  <RaffleCard raffle={r} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} nowMs={nowS * 1000} userEntry={r.userEntry} />
                  {isRefunded && <div className="db-history-badge refunded">↩ Ticket Refunded</div>}
                  {iWon && <div className="db-history-badge won">🏆 Winner</div>}
                  {iLost && <div className="db-history-badge lost">Lost - Better luck next time!</div>}
                </div>
              );
            })}
          </div>
        )}

        {tab === "created" && (
          <div className="db-grid">
            {/* ✅ empty state only when not cold loading */}
            {!data.isColdLoading && data.created.length === 0 && <div className="db-empty">You haven't hosted any raffles yet.</div>}

            {data.created.map((r: any) => (
              <RaffleCard key={r.id} raffle={r} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} nowMs={nowS * 1000} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}