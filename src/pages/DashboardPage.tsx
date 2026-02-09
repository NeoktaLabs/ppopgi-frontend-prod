// src/pages/DashboardPage.tsx
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
  onBrowse?: () => void;
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

const ACTIVE_STATUSES = ["OPEN", "FUNDING_PENDING", "DRAWING"] as const;

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}

function normId(v: string): string {
  const s = String(v || "").toLowerCase();
  if (!s) return s;
  return s.startsWith("0x") ? s : `0x${s}`;
}

function pluralTickets(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  return x === 1 ? "ticket" : "tickets";
}

/**
 * Fetch "ticketsPurchased" (historical total bought) for the current buyer
 */
async function fetchTicketsPurchasedByRaffle(
  raffleIds: string[],
  buyer: string,
  signal?: AbortSignal
): Promise<Map<string, number>> {
  const url = mustEnv("VITE_SUBGRAPH_URL");
  const ids = Array.from(new Set(raffleIds.map((x) => normId(x)))).filter(Boolean);
  const out = new Map<string, number>();
  if (!ids.length || !buyer) return out;

  const chunkSize = 150;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const query = `
      query MyTicketsPurchased($buyer: Bytes!, $ids: [Bytes!]!) {
        raffleParticipants(
          first: 1000
          where: { buyer: $buyer, raffle_in: $ids }
        ) {
          raffle { id }
          ticketsPurchased
        }
      }
    `;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          variables: { buyer: buyer.toLowerCase(), ids: chunk.map((x) => x.toLowerCase()) },
        }),
        signal,
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        continue;
      }

      if (!res.ok || json?.errors?.length) continue;

      const rows = (json?.data?.raffleParticipants ?? []) as any[];
      for (const r of rows) {
        const id = normId(r?.raffle?.id || "");
        const n = Number(r?.ticketsPurchased || 0);
        if (!id) continue;
        out.set(id, Math.max(out.get(id) ?? 0, Number.isFinite(n) ? n : 0));
      }
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Multiplier Badge (Ticket Stub Style)
 */
function MultiplierBadge({ count }: { count: number }) {
  const safe = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  const display = safe > 999 ? "999+" : String(safe);
  const label = safe === 1 ? "Ticket" : "Tickets";

  return (
    <div className="db-mult-badge" aria-label={`${safe} tickets`}>
      <span style={{ fontSize: "1.25em", marginRight: "4px" }}>{display}</span>
      <span style={{ fontSize: "0.7em", opacity: 0.85, fontWeight: 700, textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

/**
 * RaffleCardPile
 * ✅ UPDATED: Hides badge if count is 0
 */
function RaffleCardPile({
  raffle,
  ticketCount,
  isWinner,
  onOpenRaffle,
  onOpenSafety,
  nowMs,
}: {
  raffle: any;
  ticketCount: number;
  isWinner: boolean;
  onOpenRaffle: (id: string) => void;
  onOpenSafety: (id: string) => void;
  nowMs: number;
}) {
  // ✅ FIX: Allow 0 tickets (don't default to 1)
  const safeTickets = Number.isFinite(ticketCount) ? Math.max(0, Math.floor(ticketCount)) : 0;
  
  // ✅ FIX: Only show badge if > 0
  const showBadge = safeTickets > 0;

  // Shadow Logic: 0 or 1 ticket = 0 shadows. 2 tickets = 1 shadow.
  const shadowCount = safeTickets > 1 ? Math.min(4, safeTickets - 1) : 0;
  const hasShadows = shadowCount > 0;

  const raffleForCard = useMemo(() => {
    const c = { ...(raffle ?? {}) };
    if ("userEntry" in c) delete (c as any).userEntry;
    if ("userTicketsOwned" in c) delete (c as any).userTicketsOwned;
    return c;
  }, [raffle]);

  const pileClass = `db-card-pile card-hover-trigger${isWinner ? " is-winner" : ""}${hasShadows ? "" : " no-shadows"}`;

  return (
    <div className="db-card-pile-wrapper">
      {/* ✅ Only render badge layer if user actually has tickets */}
      {showBadge && (
        <div className="db-mult-badge-layer" aria-hidden="true">
          <MultiplierBadge count={safeTickets} />
        </div>
      )}

      {/* Pile itself */}
      <div className={pileClass}>
        {shadowCount >= 4 && (
          <div className="db-card-shadow db-card-shadow-4" aria-hidden="true">
            <div className="db-card-shadow-inner">
              <div className="db-card-shadow-card">
                <RaffleCard raffle={raffleForCard} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} nowMs={nowMs} />
              </div>
            </div>
          </div>
        )}
        {shadowCount >= 3 && (
          <div className="db-card-shadow db-card-shadow-3" aria-hidden="true">
            <div className="db-card-shadow-inner">
              <div className="db-card-shadow-card">
                <RaffleCard raffle={raffleForCard} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} nowMs={nowMs} />
              </div>
            </div>
          </div>
        )}
        {shadowCount >= 2 && (
          <div className="db-card-shadow db-card-shadow-2" aria-hidden="true">
            <div className="db-card-shadow-inner">
              <div className="db-card-shadow-card">
                <RaffleCard raffle={raffleForCard} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} nowMs={nowMs} />
              </div>
            </div>
          </div>
        )}
        {shadowCount >= 1 && (
          <div className="db-card-shadow db-card-shadow-1" aria-hidden="true">
            <div className="db-card-shadow-inner">
              <div className="db-card-shadow-card">
                <RaffleCard raffle={raffleForCard} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} nowMs={nowMs} />
              </div>
            </div>
          </div>
        )}

        <div className="db-card-front">
          <div className="db-card-front-card">
            <RaffleCard raffle={raffleForCard} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} nowMs={nowMs} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardPage({ account: accountProp, onOpenRaffle, onOpenSafety, onBrowse }: Props) {
  useEffect(() => {
    document.title = "Ppopgi 뽑기 — Dashboard";
  }, []);

  const { data, actions, account: hookAccount } = useDashboardController();
  const account = hookAccount ?? accountProp;

  const [tab, setTab] = useState<"active" | "joined" | "created">("active");
  const [copied, setCopied] = useState(false);
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

  const { active: activeJoined, past: pastJoined } = useMemo(() => {
    const active: any[] = [];
    const past: any[] = [];

    if (!data.joined) return { active, past };

    data.joined.forEach((r: any) => {
      const tickets = Number(r.userTicketsOwned || 0);
      const sold = Math.max(0, Number(r.sold || 0));
      const percentage = sold > 0 ? ((tickets / sold) * 100).toFixed(1) : "0.0";
      const enriched = { ...r, userEntry: { count: tickets, percentage } };

      if (ACTIVE_STATUSES.includes(r.status)) active.push(enriched);
      else past.push(enriched);
    });

    return { active, past };
  }, [data.joined]);

  const activeCreated = useMemo(() => {
    const active: any[] = [];
    const arr = data.created ?? [];
    arr.forEach((r: any) => {
      if (ACTIVE_STATUSES.includes(r.status)) active.push(r);
    });
    return active;
  }, [data.created]);

  const ongoingRaffles = useMemo(() => {
    const byId = new Map<string, any>();
    for (const r of activeJoined) byId.set(String(r.id), r);
    for (const r of activeCreated) {
      const id = String(r.id);
      if (!byId.has(id)) byId.set(id, r);
    }
    return Array.from(byId.values());
  }, [activeJoined, activeCreated]);

  const createdCount = data.created?.length ?? 0;
  const joinedCount = pastJoined.length;

  const msgIsSuccess = useMemo(() => {
    if (!data.msg) return false;
    return /success|successful|claimed/i.test(data.msg);
  }, [data.msg]);

  const getPrimaryMethod = (opts: { isRefund: boolean; hasUsdc: boolean; hasNative: boolean }): WithdrawMethod | null => {
    const { isRefund, hasUsdc, hasNative } = opts;
    if (isRefund) return hasUsdc ? "claimTicketRefund" : null;
    if (hasUsdc) return "withdrawFunds";
    if (hasNative) return "withdrawNative";
    return null;
  };

  const hasClaims = data.claimables.length > 0;
  const showColdSkeletons = data.isColdLoading && ongoingRaffles.length === 0;

  const [purchasedByRaffle, setPurchasedByRaffle] = useState<Map<string, number>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const relevantRaffleIdsForPurchased = useMemo(() => {
    const ids = [...ongoingRaffles.map((r: any) => String(r.id)), ...pastJoined.map((r: any) => String(r.id))];
    return Array.from(new Set(ids.map((x) => normId(x))));
  }, [ongoingRaffles, pastJoined]);

  const loadPurchased = useCallback(async () => {
    if (!account) {
      setPurchasedByRaffle(new Map());
      return;
    }
    try {
      abortRef.current?.abort();
    } catch {}
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const map = await fetchTicketsPurchasedByRaffle(relevantRaffleIdsForPurchased, account, ac.signal);
      if (!ac.signal.aborted) setPurchasedByRaffle(map);
    } catch {
      /* ignore */
    }
  }, [account, relevantRaffleIdsForPurchased]);

  useEffect(() => {
    void loadPurchased();
    return () => {
      try {
        abortRef.current?.abort();
      } catch {}
    };
  }, [loadPurchased]);

  const getPurchasedEver = (raffleId: string) => purchasedByRaffle.get(normId(raffleId)) ?? 0;

  return (
    <div className="db-container">
      <div className="db-hero">
        <div className="db-hero-content">
          <div className="db-avatar-circle">👤</div>
          <div>
            <div className="db-hero-label">Player Dashboard</div>
            <div className="db-hero-addr" onClick={handleCopy} title="Click to Copy">
              {account ? shortAddr(account, 8, 6) : "Not Connected"}
              {account && <span className="db-copy-icon">{copied ? "✅" : "📋"}</span>}
            </div>
          </div>
        </div>

        <div className="db-hero-stats">
          <div className="db-stat">
            <div className="db-stat-num">{ongoingRaffles.length}</div>
            <div className="db-stat-lbl">Live</div>
          </div>
          <div className="db-stat">
            <div className="db-stat-num">{pastJoined.length}</div>
            <div className="db-stat-lbl">Joined</div>
          </div>
          <div className="db-stat">
            <div className="db-stat-num">{createdCount}</div>
            <div className="db-stat-lbl">Created</div>
          </div>
          {hasClaims && (
            <div className="db-stat highlight">
              <div className="db-stat-num">{data.claimables.length}</div>
              <div className="db-stat-lbl">To Claim</div>
            </div>
          )}
        </div>
      </div>

      {data.msg && <div className={`db-msg-banner ${msgIsSuccess ? "success" : "error"}`}>{data.msg}</div>}

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

              const ownedNow = Number(it.userTicketsOwned || 0);
              const purchasedEver = getPurchasedEver(r.id);
              const displayTicketCount = ownedNow > 0 ? ownedNow : purchasedEver;

              const primaryMethod = getPrimaryMethod({ isRefund, hasUsdc, hasNative });

              let badgeTitle = "Claim Available";
              let message = "Funds available to claim.";
              let primaryLabel = "Claim";

              if (isRefund) {
                badgeTitle = "Refund";
                message =
                  displayTicketCount > 0
                    ? `Raffle canceled — reclaim the cost of your ${displayTicketCount} ${pluralTickets(displayTicketCount)}.`
                    : "Raffle canceled — reclaim your refund.";
                primaryLabel = "Reclaim Refund";
              } else if (iAmWinner) {
                badgeTitle = "Winner";
                message = "You won 🎉 Claim your prize now.";
                primaryLabel = "Claim Prize";
              } else if (iAmCreator) {
                badgeTitle = "Creator";
                message = "Ticket sales are settled — withdraw revenue.";
                primaryLabel = "Withdraw Revenue";
              } else {
                badgeTitle = "Claim";
                message = "Funds available to withdraw.";
                primaryLabel = hasUsdc ? "Claim USDC" : hasNative ? "Claim Native" : "Claim";
              }

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
                          <button className="db-btn primary" disabled={data.isPending} onClick={() => actions.withdraw(r.id, "withdrawFunds")}>
                            {data.isPending ? "Processing..." : "Claim USDC"}
                          </button>
                          <button className="db-btn secondary" disabled={data.isPending} onClick={() => actions.withdraw(r.id, "withdrawNative")}>
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

      <div className="db-section-header">
        <div className="db-section-title">My Raffles</div>
      </div>

      <div className="db-tabs-container">
        <div className="db-tabs">
          <button className={`db-tab ${tab === "active" ? "active" : ""}`} onClick={() => setTab("active")}>
            <span className="db-tab-live">
              <span className="db-live-dot" aria-hidden="true" />
              Live <span className="db-tab-count">({ongoingRaffles.length})</span>
            </span>
          </button>

          <button className={`db-tab ${tab === "joined" ? "active" : ""}`} onClick={() => setTab("joined")}>
            Joined <span className="db-tab-count">({joinedCount})</span>
          </button>

          <button className={`db-tab ${tab === "created" ? "active" : ""}`} onClick={() => setTab("created")}>
            Created <span className="db-tab-count">({createdCount})</span>
          </button>
        </div>
      </div>

      <div className="db-grid-area">
        {tab === "active" && (
          <div className="db-grid">
            {showColdSkeletons && (
              <>
                <RaffleCardSkeleton />
                <RaffleCardSkeleton />
              </>
            )}

            {!data.isColdLoading && ongoingRaffles.length === 0 && (
              <div className="db-empty">
                <div className="db-empty-icon">🎟️</div>
                <div>You have no on-going raffles.</div>
                {onBrowse && (
                  <button className="db-btn-browse" onClick={onBrowse}>
                    Browse Raffles
                  </button>
                )}
              </div>
            )}

            {ongoingRaffles.map((r: any) => {
              const ownedNow = Number(r.userEntry?.count ?? 0);
              const purchasedEver = getPurchasedEver(r.id);
              const ticketCount = ownedNow > 0 ? ownedNow : purchasedEver;

              return (
                <RaffleCardPile
                  key={r.id}
                  raffle={r}
                  // ✅ FIX: No longer forcing || 1. Passing exact count (0 if creator/new).
                  ticketCount={ticketCount}
                  isWinner={false}
                  onOpenRaffle={onOpenRaffle}
                  onOpenSafety={onOpenSafety}
                  nowMs={nowS * 1000}
                />
              );
            })}
          </div>
        )}

        {tab === "joined" && (
          <div className="db-grid">
            {!data.isColdLoading && pastJoined.length === 0 && (
              <div className="db-empty">
                <div className="db-empty-icon">📂</div>
                <div>No joined raffles history found.</div>
              </div>
            )}

            {pastJoined.map((r: any) => {
              const acct = norm(account);
              const winner = norm(r.winner);

              const ownedNow = Number(r.userEntry?.count ?? 0);
              const purchasedEver = getPurchasedEver(r.id);
              const ticketCount = ownedNow > 0 ? ownedNow : purchasedEver;

              const completed = r.status === "COMPLETED";
              const iWon = completed && acct && winner === acct;

              const canceled = r.status === "CANCELED";
              const isRefunded = canceled && ownedNow === 0 && purchasedEver > 0;

              const participatedEver = purchasedEver > 0;
              const iLost = completed && participatedEver && !iWon;

              return (
                <div key={r.id} className={`db-history-card-wrapper ${iLost ? "is-lost" : ""}`}>
                  <RaffleCardPile
                    raffle={r}
                    ticketCount={ticketCount || 1}
                    isWinner={!!iWon}
                    onOpenRaffle={onOpenRaffle}
                    onOpenSafety={onOpenSafety}
                    nowMs={nowS * 1000}
                  />

                  {isRefunded && (
                    <div className="db-history-badge refunded">
                      ↩ Refunded ({purchasedEver} {pluralTickets(purchasedEver)})
                    </div>
                  )}
                  {iWon && <div className="db-history-badge won">🏆 Winner</div>}
                  {iLost && <div className="db-history-badge lost">Better luck next time</div>}
                </div>
              );
            })}
          </div>
        )}

        {tab === "created" && (
          <div className="db-grid">
            {!data.isColdLoading && data.created.length === 0 && (
              <div className="db-empty">
                <div className="db-empty-icon">✨</div>
                <div>You haven't hosted any raffles yet.</div>
              </div>
            )}

            {data.created.map((r: any) => (
              <RaffleCard key={r.id} raffle={r} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} nowMs={nowS * 1000} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default DashboardPage;
