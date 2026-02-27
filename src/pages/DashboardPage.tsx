// src/pages/DashboardPage.tsx
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { formatUnits } from "ethers";
import { LotteryCard } from "../components/LotteryCard";
import { LotteryCardSkeleton } from "../components/LotteryCardSkeleton";
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
  onOpenLottery: (id: string) => void; // can rename later to onOpenLottery
  onOpenSafety: (id: string) => void;
  onBrowse?: () => void;
};

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

function safeBigInt(v: any): bigint {
  try {
    if (v === null || v === undefined) return 0n;
    const s = String(v);
    if (!s) return 0n;
    return BigInt(s);
  } catch {
    return 0n;
  }
}

/**
 * ✅ Updated for new subgraph:
 * userLotteries(where: { user: <buyer>, lottery_in: [...] }) { lottery { id } ticketsPurchased }
 */
async function fetchTicketsPurchasedByLottery(
  lotteryIds: string[],
  buyer: string,
  signal?: AbortSignal
): Promise<Map<string, number>> {
  const url = mustEnv("VITE_SUBGRAPH_URL");
  const ids = Array.from(new Set(lotteryIds.map((x) => normId(x)))).filter(Boolean);
  const out = new Map<string, number>();
  if (!ids.length || !buyer) return out;

  const chunkSize = 200;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);

    const query = `
      query MyTicketsPurchased($user: Bytes!, $ids: [Bytes!]!) {
        userLotteries(
          first: 1000
          where: { user: $user, lottery_in: $ids }
        ) {
          lottery { id }
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
          variables: { user: buyer.toLowerCase(), ids: chunk.map((x) => x.toLowerCase()) },
        }),
        signal,
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || json?.errors?.length) continue;

      const rows = (json?.data?.userLotteries ?? []) as any[];
      for (const r of rows) {
        const id = normId(r?.lottery?.id || "");
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
 * Multiplier Badge (Premium Golden Ticket Style)
 */
function MultiplierBadge({ count }: { count: number }) {
  const safe = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  const display = safe > 999 ? "999+" : String(safe);
  const label = safe === 1 ? "Ticket" : "Tickets";

  return (
    <div className="db-mult-badge" aria-label={`${safe} tickets`}>
      <span className="db-badge-count">{display}</span>
      <span className="db-badge-label">{label}</span>
    </div>
  );
}

function LotteryCardPile({
  lottery,
  ticketCount,
  isWinner,
  onOpenLottery,
  onOpenSafety,
  nowMs,
}: {
  lottery: any;
  ticketCount: number;
  isWinner: boolean;
  onOpenLottery: (id: string) => void;
  onOpenSafety: (id: string) => void;
  nowMs: number;
}) {
  const safeTickets = Number.isFinite(ticketCount) ? Math.max(0, Math.floor(ticketCount)) : 0;
  const showBadge = safeTickets > 0;

  const shadowCount = safeTickets > 1 ? Math.min(4, safeTickets - 1) : 0;
  const hasShadows = shadowCount > 0;

  const lotteryForCard = useMemo(() => {
    const c = { ...(lottery ?? {}) };
    if ("userEntry" in c) delete (c as any).userEntry;
    if ("userTicketsOwned" in c) delete (c as any).userTicketsOwned;
    return c;
  }, [lottery]);

  const pileClass = `db-card-pile card-hover-trigger${isWinner ? " is-winner" : ""}${hasShadows ? "" : " no-shadows"}`;

  return (
    <div className="db-card-pile-wrapper">
      {showBadge && (
        <div className="db-mult-badge-layer" aria-hidden="true">
          <MultiplierBadge count={safeTickets} />
        </div>
      )}

      <div className={pileClass}>
        {shadowCount >= 4 && (
          <div className="db-card-shadow db-card-shadow-4" aria-hidden="true">
            <div className="db-card-shadow-inner">
              <div className="db-card-shadow-card">
                <LotteryCard lottery={lotteryForCard} onOpen={onOpenLottery} onOpenSafety={onOpenSafety} nowMs={nowMs} />
              </div>
            </div>
          </div>
        )}
        {shadowCount >= 3 && (
          <div className="db-card-shadow db-card-shadow-3" aria-hidden="true">
            <div className="db-card-shadow-inner">
              <div className="db-card-shadow-card">
                <LotteryCard lottery={lotteryForCard} onOpen={onOpenLottery} onOpenSafety={onOpenSafety} nowMs={nowMs} />
              </div>
            </div>
          </div>
        )}
        {shadowCount >= 2 && (
          <div className="db-card-shadow db-card-shadow-2" aria-hidden="true">
            <div className="db-card-shadow-inner">
              <div className="db-card-shadow-card">
                <LotteryCard lottery={lotteryForCard} onOpen={onOpenLottery} onOpenSafety={onOpenSafety} nowMs={nowMs} />
              </div>
            </div>
          </div>
        )}
        {shadowCount >= 1 && (
          <div className="db-card-shadow db-card-shadow-1" aria-hidden="true">
            <div className="db-card-shadow-inner">
              <div className="db-card-shadow-card">
                <LotteryCard lottery={lotteryForCard} onOpen={onOpenLottery} onOpenSafety={onOpenSafety} nowMs={nowMs} />
              </div>
            </div>
          </div>
        )}

        <div className="db-card-front">
          <div className="db-card-front-card">
            <LotteryCard lottery={lotteryForCard} onOpen={onOpenLottery} onOpenSafety={onOpenSafety} nowMs={nowMs} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardPage({ account: accountProp, onOpenLottery, onOpenSafety, onBrowse }: Props) {
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

  // ✅ lock: prevent duplicate tx from rapid clicking
  const txLockRef = useRef(false);
  const perLotteryLockRef = useRef<Map<string, boolean>>(new Map());

  const onClaim = useCallback(
    async (lotteryId: string): Promise<boolean> => {
      const lid = normId(lotteryId);
      if (txLockRef.current) return false;
      if (perLotteryLockRef.current.get(lid)) return false;

      txLockRef.current = true;
      perLotteryLockRef.current.set(lid, true);

      try {
        return await actions.claim(lid);
      } finally {
        setTimeout(() => {
          txLockRef.current = false;
          perLotteryLockRef.current.delete(lid);
        }, 250);
      }
    },
    [actions]
  );

  const { active: activeJoined, past: pastJoined } = useMemo(() => {
    const active: any[] = [];
    const past: any[] = [];

    (data.joined ?? []).forEach((r: any) => {
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
    (data.created ?? []).forEach((r: any) => {
      if (ACTIVE_STATUSES.includes(r.status)) active.push(r);
    });
    return active;
  }, [data.created]);

  const ongoingLotteries = useMemo(() => {
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

  const hasClaims = (data.claimables?.length ?? 0) > 0;
  const showColdSkeletons = data.isColdLoading && ongoingLotteries.length === 0;

  const [purchasedByLottery, setPurchasedByLottery] = useState<Map<string, number>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const relevantLotteryIdsForPurchased = useMemo(() => {
    const ids = [...ongoingLotteries.map((r: any) => String(r.id)), ...pastJoined.map((r: any) => String(r.id))];
    return Array.from(new Set(ids.map((x) => normId(x))));
  }, [ongoingLotteries, pastJoined]);

  const loadPurchased = useCallback(async () => {
    if (!account) {
      setPurchasedByLottery(new Map());
      return;
    }
    try {
      abortRef.current?.abort();
    } catch {}
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const map = await fetchTicketsPurchasedByLottery(relevantLotteryIdsForPurchased, account, ac.signal);
      if (!ac.signal.aborted) setPurchasedByLottery(map);
    } catch {
      /* ignore */
    }
  }, [account, relevantLotteryIdsForPurchased]);

  useEffect(() => {
    void loadPurchased();
    return () => {
      try {
        abortRef.current?.abort();
      } catch {}
    };
  }, [loadPurchased]);

  const getPurchasedEver = (lotteryId: string) => purchasedByLottery.get(normId(lotteryId)) ?? 0;

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
            <div className="db-stat-num">{ongoingLotteries.length}</div>
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

      {/* ---------------- Claimables ---------------- */}
      <div className="db-section claim-section">
        <div className="db-section-header">
          <div className="db-section-title">Claimables</div>
          {hasClaims && <span className="db-pill pulse">Action Required</span>}
          <div className="db-section-line" />
        </div>

        {!hasClaims ? (
          <div className="db-empty-claims">
            <div style={{ fontSize: 24, marginBottom: 8 }}>🎉</div>
            <div>You’ve already claimed everything!</div>
          </div>
        ) : (
          <div className="db-grid">
            {data.claimables.map((it: any) => {
              const r = it.lottery; // ✅ new shape

              const roles = it.roles ?? {};
              const hasRefund = safeBigInt(it.refundUsdc) > 0n;
              const hasClaimable = safeBigInt(it.claimableUsdc) > 0n;
              const totalU6 = safeBigInt(it.totalUsdc);

              const status = String(r.status || "").toUpperCase();
              const isCanceled = status === "CANCELED";
              const isSettled = status === "COMPLETED";

              let badgeTitle = "Claim";
              let message = "Funds available to claim.";
              let primaryLabel = "Claim";
              let badgeKind: "refund" | "winner" | "creator" | "claim" = "claim";

              if (hasRefund || it.type === "REFUND") {
                badgeTitle = "Refund";
                badgeKind = "refund";
                message = "Lottery canceled — reclaim your refund.";
                primaryLabel = "Claim Refund";
              } else if (isSettled && roles.winner) {
                badgeTitle = "Winner";
                badgeKind = "winner";
                message = "Congrats — you won! Reclaim your prize.";
                primaryLabel = "Claim Prize";
              } else if ((isSettled || isCanceled) && roles.feeRecipient) {
                badgeTitle = "Fees";
                badgeKind = "claim";
                message = "Protocol fees available — reclaim them.";
                primaryLabel = "Claim Fees";
              } else if (isSettled && roles.created) {
                badgeTitle = "Creator";
                badgeKind = "creator";
                message = "Lottery settled — reclaim ticket sales.";
                primaryLabel = "Claim Ticket Sales";
              } else if (hasClaimable) {
                badgeTitle = "Claim";
                badgeKind = "claim";
                message = "Funds available to claim.";
                primaryLabel = "Claim";
              }

              const ownedNow = Number(it.userTicketsOwned || 0);
              const purchasedEver = getPurchasedEver(r.id);
              const displayTicketCount = ownedNow > 0 ? ownedNow : purchasedEver;

              return (
                <div key={r.id} className="db-claim-wrapper">
                  <LotteryCard lottery={r} onOpen={onOpenLottery} onOpenSafety={onOpenSafety} nowMs={nowS * 1000} />

                  <div className="db-claim-cut-line" />

                  <div className="db-claim-box">
                    <div className="db-claim-header">
                      <span className={`db-claim-badge ${badgeKind}`}>{badgeTitle}</span>
                    </div>

                    <div className="db-claim-text">
                      <div className="db-claim-msg">{message}</div>

                      {(hasRefund || it.type === "REFUND") && displayTicketCount > 0 && (
                        <div className="db-refund-sub" style={{ marginTop: 6, opacity: 0.85 }}>
                          You had {displayTicketCount} {pluralTickets(displayTicketCount)}.
                        </div>
                      )}

                      <div className="db-win-layout" style={{ marginTop: 10 }}>
                        <div className="db-win-label">Available:</div>
                        <div className="db-win-val">
                          <span>{fmt(totalU6.toString(), 6)} USDC</span>
                          {hasRefund && hasClaimable && (
                            <span style={{ opacity: 0.75 }}>
                              {" "}
                              (Refund {fmt(String(it.refundUsdc), 6)} + Claimable {fmt(String(it.claimableUsdc), 6)})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="db-claim-actions">
                      <button
                        type="button"
                        className="db-btn primary"
                        disabled={data.isPending || txLockRef.current || totalU6 <= 0n}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void onClaim(r.id);
                        }}
                      >
                        {data.isPending ? "Processing..." : primaryLabel}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------- My Lotteries ---------------- */}
      <div className="db-section-header">
        <div className="db-section-title">My Lotteries</div>
        <div className="db-section-line" />
      </div>

      <div className="db-tabs-container">
        <div className="db-tabs">
          <button className={`db-tab ${tab === "active" ? "active" : ""}`} onClick={() => setTab("active")}>
            <span className="db-tab-live">
              <span className="db-live-dot" aria-hidden="true" />
              Live <span className="db-tab-count">({ongoingLotteries.length})</span>
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
                <LotteryCardSkeleton />
                <LotteryCardSkeleton />
              </>
            )}

            {!data.isColdLoading && ongoingLotteries.length === 0 && (
              <div className="db-empty">
                <div className="db-empty-icon">🎟️</div>
                <div>You have no on-going raffles.</div>
                {onBrowse && (
                  <button className="db-btn-browse" onClick={onBrowse}>
                    Browse Lotteries
                  </button>
                )}
              </div>
            )}

            {ongoingLotteries.map((r: any) => {
              const ownedNow = Number(r.userEntry?.count ?? 0);
              const purchasedEver = getPurchasedEver(r.id);
              const ticketCount = ownedNow > 0 ? ownedNow : purchasedEver;

              return (
                <LotteryCardPile
                  key={r.id}
                  lottery={r}
                  ticketCount={ticketCount}
                  isWinner={false}
                  onOpenLottery={onOpenLottery}
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
              const acct2 = norm(account);
              const winner2 = norm(r.winner);

              const ownedNow = Number(r.userEntry?.count ?? 0);
              const purchasedEver = getPurchasedEver(r.id);
              const ticketCount = ownedNow > 0 ? ownedNow : purchasedEver;

              const completed = r.status === "COMPLETED";
              const iWon = completed && acct2 && winner2 === acct2;

              const canceled = r.status === "CANCELED";
              const isCanceledParticipant = canceled && purchasedEver > 0;

              const participatedEver = purchasedEver > 0;
              const iLost = completed && participatedEver && !iWon;

              return (
                <div key={r.id} className={`db-history-card-wrapper ${iLost ? "is-lost" : ""}`}>
                  <LotteryCardPile
                    lottery={r}
                    ticketCount={ticketCount || 1}
                    isWinner={!!iWon}
                    onOpenLottery={onOpenLottery}
                    onOpenSafety={onOpenSafety}
                    nowMs={nowS * 1000}
                  />

                  {isCanceledParticipant && (
                    <div className="db-history-badge refunded">
                      ⚠️ Canceled ({purchasedEver} {pluralTickets(purchasedEver)})
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
            {!data.isColdLoading && (data.created?.length ?? 0) === 0 && (
              <div className="db-empty">
                <div className="db-empty-icon">✨</div>
                <div>You haven't hosted any raffles yet.</div>
              </div>
            )}

            {(data.created ?? []).map((r: any) => (
              <LotteryCard key={r.id} lottery={r} onOpen={onOpenLottery} onOpenSafety={onOpenSafety} nowMs={nowS * 1000} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default DashboardPage;