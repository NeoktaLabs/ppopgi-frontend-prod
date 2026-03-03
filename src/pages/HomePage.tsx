// src/pages/HomePage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useHomeLotteries } from "../hooks/useHomeLotteries";
import { useInfraStatus } from "../hooks/useInfraStatus";
import { useGlobalStatsBillboard } from "../hooks/useGlobalStatsBillboard";
import { LotteryCard } from "../components/LotteryCard";
import { LotteryCardSkeleton } from "../components/LotteryCardSkeleton";
import { ActivityBoard } from "../components/ActivityBoard";
import "./HomePage.css";

// ✅ UI Helper: prettify large numbers (supports bigint safely)
function fmtInt(n: bigint | number | string) {
  try {
    if (typeof n === "bigint") return n.toLocaleString("en-US");
    const v = Number(n);
    if (!Number.isFinite(v)) return "0";
    return v.toLocaleString("en-US");
  } catch {
    return "0";
  }
}

// ✅ UI Helper: format USDC bigint (6 decimals) as "$X,XXX"
function fmtUSDC(v: bigint | number | string, opts?: { decimals?: number; maxFrac?: number }) {
  const decimals = opts?.decimals ?? 6;
  const maxFrac = opts?.maxFrac ?? 0;

  try {
    const x =
      typeof v === "bigint" ? v : BigInt(typeof v === "number" ? Math.trunc(v) : String(v || "0").trim() || "0");

    const sign = x < 0n ? "-" : "";
    const a = x < 0n ? -x : x;

    const base = 10n ** BigInt(decimals);
    const whole = a / base;
    const frac = a % base;

    const wholeStr = whole.toLocaleString("en-US");
    if (maxFrac <= 0) return `${sign}$${wholeStr}`;

    const fracStrFull = frac.toString().padStart(decimals, "0");
    const fracStr = fracStrFull.slice(0, maxFrac).replace(/0+$/, "");
    return fracStr ? `${sign}$${wholeStr}.${fracStr}` : `${sign}$${wholeStr}`;
  } catch {
    return "$0";
  }
}

type Props = {
  nowMs: number;
  onOpenLottery: (id: string) => void;
  onOpenSafety: (id: string) => void;
};

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function openCashierFromHome() {
  try {
    window.dispatchEvent(new CustomEvent("ppopgi:open-cashier"));
  } catch {}
}

function navigateFromHome(page: "home" | "explore" | "dashboard" | "about" | "faq") {
  try {
    window.dispatchEvent(new CustomEvent("ppopgi:navigate", { detail: { page } }));
  } catch {}
}

// Sliding banner
const BANNER_MESSAGES = [
  { id: "cashier", text: "💡 Pro tip: Visit the Cashier to buy more XTZ or USDC", action: openCashierFromHome },
  { id: "explore", text: "🔎 Discover all lotteries from the Explore page", action: () => navigateFromHome("explore") },
  {
    id: "dashboard",
    text: "🎁 Visit your dashboard to reclaim prizes or tickets",
    action: () => navigateFromHome("dashboard"),
  },
  { id: "about", text: "📖 Read the story behind Ppopgi (뽑기)", action: () => navigateFromHome("about") },
  { id: "faq", text: "❓ Learn how Ppopgi (뽑기) works (FAQ)", action: () => navigateFromHome("faq") },
];

function BannerSlider() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIdx((prev) => (prev + 1) % BANNER_MESSAGES.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="hp-banner-wrapper">
      <div className="hp-banner-track" style={{ transform: `translateX(-${idx * 100}%)` }}>
        {BANNER_MESSAGES.map((msg) => (
          <div key={msg.id} className="hp-banner-slide">
            <button className="hp-banner-btn" onClick={msg.action}>
              {msg.text}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomePage({ nowMs, onOpenLottery, onOpenSafety }: Props) {
  useEffect(() => {
    document.title = "Ppopgi 뽑기 — Home";
  }, []);

  const infra = useInfraStatus();
  const { bigPrizes, endingSoon, recentlyFinalized, isLoading, refetch } = useHomeLotteries();
  const gs = useGlobalStatsBillboard();

  const finalizerForCards = useMemo(
    () => ({
      running: !!infra.bot?.running,
      secondsToNextRun: infra.bot?.secondsToNextRun ?? null,
      tsMs: infra.tsMs,
    }),
    [infra.bot?.running, infra.bot?.secondsToNextRun, infra.tsMs]
  );

  useEffect(() => {
    const onFocus = () => {
      try {
        refetch();
        gs.refetch();
      } catch {}
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch, gs]);

  const podium = useMemo(() => {
    if (!bigPrizes || bigPrizes.length === 0) return { gold: null, silver: null, bronze: null };
    const sorted = [...bigPrizes].sort((a, b) => {
      try {
        return BigInt(a.winningPot || "0") < BigInt(b.winningPot || "0") ? 1 : -1;
      } catch {
        return 0;
      }
    });
    return { gold: sorted[0] || null, silver: sorted[1] || null, bronze: sorted[2] || null };
  }, [bigPrizes]);

  const endingSoonSorted = useMemo(() => {
    if (!endingSoon) return [];
    return [...endingSoon].sort((a, b) => num(a.deadline) - num(b.deadline));
  }, [endingSoon]);

  const recentlySettledSorted = useMemo(() => {
    return (recentlyFinalized ?? []).slice(0, 5);
  }, [recentlyFinalized]);

  const endingRef = useRef<HTMLDivElement | null>(null);
  const settledRef = useRef<HTMLDivElement | null>(null);

  // Stats data
  const stats = useMemo(() => {
    if (!gs.data) return null;
    return {
      tix: fmtInt(gs.data.totalTicketsSold),
      lots: fmtInt(gs.data.totalLotteriesCreated),

      // ✅ NEW: dollars (USDC is 6 decimals)
      activeUsd: fmtUSDC(gs.data.activeVolumeUSDC, { maxFrac: 0 }),
      settledUsd: fmtUSDC(gs.data.totalPrizesSettledUSDC, { maxFrac: 0 }),
    };
  }, [gs.data]);

  return (
    <>
      {/* ✅ TOP: Banner slider sits directly below TopNav (first content) */}
      <div className="hp-announcement-bar hp-announcement-top">
        <BannerSlider />
      </div>

      {/* ✅ HERO */}
      <div className="hp-hero-card hp-billboard">
        <div className="hp-billboard-bg" />
        <div className="hp-billboard-sparkles" />

        <div className="hp-hero-content">
          <div className="hp-badge-shimmer">
            <div className="hp-hero-badge">✨ The Fair On-Chain Lottery</div>
          </div>
          <div className="hp-hero-title">
            Welcome to <br />
            <span className="hp-text-gradient">Ppopgi (뽑기)</span>
          </div>
          <div className="hp-hero-sub">
            A decentralized playground where every spin is fair, transparent, and verified on-chain.
          </div>

          <div className="hp-hero-actions">
            <button className="hp-btn-primary" onClick={() => navigateFromHome("explore")}>
              Explore Lotteries
            </button>
            <button className="hp-btn-secondary" onClick={() => navigateFromHome("faq")}>
              Learn More
            </button>
          </div>
        </div>

        <div className="hp-stats-dock">
          <div className="hp-stats-title-wrap">
            <div className="hp-stats-title">Live Ppopgi (뽑기) Stats</div>
          </div>

          {gs.error ? (
            <div style={{ opacity: 0.5, fontSize: 13, fontWeight: 700 }}>Stats currently unavailable</div>
          ) : !stats ? (
            <div style={{ opacity: 0.5, fontSize: 13, fontWeight: 700 }}>Loading stats...</div>
          ) : (
            <div className="hp-stats-row">
              <div className="hp-stat-item highlight">
                <div className="hp-stat-val hp-count-pop">{stats.tix}</div>
                <div className="hp-stat-lbl">Tickets Sold</div>
              </div>

              <div className="hp-stat-sep" />

              <div className="hp-stat-item">
                <div className="hp-stat-val hp-count-pop">{stats.lots}</div>
                <div className="hp-stat-lbl">Lotteries Created</div>
              </div>

              <div className="hp-stat-sep" />

              {/* ✅ NEW: $ volumes (replaces settled/canceled counters) */}
              <div className="hp-stat-item">
                <div className="hp-stat-val hp-count-pop">{stats.activeUsd}</div>
                <div className="hp-stat-lbl">Active Volume</div>
              </div>

              <div className="hp-stat-sep" />

              <div className="hp-stat-item">
                <div className="hp-stat-val hp-count-pop">{stats.settledUsd}</div>
                <div className="hp-stat-lbl">Prizes Settled</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ✅ ATTACHED: ActivityBoard visually “wired” to hero */}
      <div className="hp-hero-attach">
        <div className="hp-hero-attach-card">
          <ActivityBoard />
        </div>
      </div>

      <div className="hp-container">
        {/* PODIUM */}
        <div className="hp-podium-section">
          <div className="hp-section-header" style={{ justifyContent: "center", marginBottom: 50 }}>
            <div className="hp-section-title">🏆 Top Active Prizepools</div>
          </div>

          <div className="hp-podium">
            {isLoading && (
              <>
                <div className="pp-silver-wrapper">
                  <LotteryCardSkeleton />
                </div>
                <div className="pp-gold-wrapper">
                  <LotteryCardSkeleton />
                </div>
                <div className="pp-bronze-wrapper">
                  <LotteryCardSkeleton />
                </div>
              </>
            )}

            {!isLoading && podium.silver && (
              <div className="pp-silver-wrapper">
                <div className="pp-rank-badge silver">2</div>
                <LotteryCard
                  lottery={podium.silver}
                  onOpen={onOpenLottery}
                  onOpenSafety={onOpenSafety}
                  ribbon="silver"
                  nowMs={nowMs}
                  finalizer={finalizerForCards}
                />
              </div>
            )}
            {!isLoading && podium.gold && (
              <div className="pp-gold-wrapper">
                <div className="pp-rank-badge gold">1</div>
                <LotteryCard
                  lottery={podium.gold}
                  onOpen={onOpenLottery}
                  onOpenSafety={onOpenSafety}
                  ribbon="gold"
                  nowMs={nowMs}
                  finalizer={finalizerForCards}
                />
              </div>
            )}
            {!isLoading && podium.bronze && (
              <div className="pp-bronze-wrapper">
                <div className="pp-rank-badge bronze">3</div>
                <LotteryCard
                  lottery={podium.bronze}
                  onOpen={onOpenLottery}
                  onOpenSafety={onOpenSafety}
                  ribbon="bronze"
                  nowMs={nowMs}
                  finalizer={finalizerForCards}
                />
              </div>
            )}
            {!isLoading && !podium.gold && !podium.silver && !podium.bronze && (
              <div className="hp-empty-msg">
                <div className="hp-empty-icon">🍃</div>
                <div>No active lotteries to display.</div>
              </div>
            )}
          </div>
        </div>

        {/* ENDING SOON */}
        <div>
          <div className="hp-section-header">
            <div className="hp-section-title">⏳ Ending Soon</div>
            <div className="hp-section-line" />
          </div>

          <div className="hp-strip-wrap">
            <div className="hp-strip" ref={endingRef}>
              {!isLoading &&
                endingSoonSorted.map((r) => (
                  <div key={r.id} className="hp-strip-item">
                    <LotteryCard
                      lottery={r}
                      onOpen={onOpenLottery}
                      onOpenSafety={onOpenSafety}
                      nowMs={nowMs}
                      finalizer={finalizerForCards}
                    />
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* RECENTLY SETTLED */}
        <div>
          <div className="hp-section-header">
            <div className="hp-section-title">✅ Recently Finalized</div>
            <div className="hp-section-line" />
          </div>

          <div className="hp-strip-wrap">
            <div className="hp-strip" ref={settledRef}>
              {!isLoading &&
                recentlySettledSorted.map((r) => (
                  <div key={r.id} className="hp-strip-item">
                    <LotteryCard
                      lottery={r}
                      onOpen={onOpenLottery}
                      onOpenSafety={onOpenSafety}
                      nowMs={nowMs}
                      finalizer={finalizerForCards}
                    />
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}