// src/pages/HomePage.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { formatUnits } from "ethers";
import { useHomeLotteries } from "../hooks/useHomeLotteries"; 
import { useInfraStatus } from "../hooks/useInfraStatus";
import { LotteryCard } from "../components/LotteryCard";
import { LotteryCardSkeleton } from "../components/LotteryCardSkeleton";
import { ActivityBoard } from "../components/ActivityBoard";
import "./HomePage.css";

type Props = {
  nowMs: number;
  onOpenLottery: (id: string) => void;
  onOpenSafety: (id: string) => void;
};

// Helpers
const fmtUsd = (val: bigint) => {
  try {
    const s = formatUnits(val, 6);
    const n = parseFloat(s);
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    });
  } catch {
    return "$0";
  }
};

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function scrollStrip(el: HTMLDivElement | null, dir: "left" | "right") {
  if (!el) return;
  const amount = Math.max(280, Math.floor(el.clientWidth * 0.85));
  el.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
}

function computeEdges(el: HTMLDivElement | null) {
  if (!el) return { atLeft: true, atRight: true };
  const left = el.scrollLeft;
  const maxLeft = el.scrollWidth - el.clientWidth;
  const eps = 2;
  return {
    atLeft: left <= eps,
    atRight: left >= maxLeft - eps,
  };
}

// Global dispatchers
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
  {
    id: "cashier",
    text: "💡 Pro tip: Visit the Cashier to buy more XTZ or USDC",
    action: openCashierFromHome,
  },
  {
    id: "explore",
    text: "🔎 Discover all lotteries from the Explore page",
    action: () => navigateFromHome("explore"),
  },
  {
    id: "dashboard",
    text: "🎁 Visit your dashboard to reclaim prizes or tickets",
    action: () => navigateFromHome("dashboard"),
  },
  {
    id: "about",
    text: "📖 Read the story behind Ppopgi",
    action: () => navigateFromHome("about"),
  },
  {
    id: "faq",
    text: "❓ Learn how Ppopgi works (FAQ)",
    action: () => navigateFromHome("faq"),
  },
];

function BannerSlider() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIdx((prev) => (prev + 1) % BANNER_MESSAGES.length);
    }, 3000);
    return () => clearInterval(timer);
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
  const { bigPrizes, endingSoon, recentlyFinalized, stats, isLoading, refetch } = useHomeLotteries();

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
      } catch {}
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  const endingRef = useRef<HTMLDivElement | null>(null);
  const settledRef = useRef<HTMLDivElement | null>(null);

  const [endingEdges, setEndingEdges] = useState({ atLeft: true, atRight: false });
  const [settledEdges, setSettledEdges] = useState({ atLeft: true, atRight: false });

  const updateEndingEdges = useCallback(() => {
    setEndingEdges(computeEdges(endingRef.current));
  }, []);

  const updateSettledEdges = useCallback(() => {
    setSettledEdges(computeEdges(settledRef.current));
  }, []);

  // Podium
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

  useEffect(() => {
    const tick = () => {
      updateEndingEdges();
      updateSettledEdges();
    };
    const t = window.setTimeout(tick, 0);
    const onResize = () => tick();
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, [isLoading, endingSoonSorted.length, recentlySettledSorted.length, updateEndingEdges, updateSettledEdges]);

  return (
    <>
      <div className="hp-announcement-bar">
        <BannerSlider />
      </div>

      <div className="hp-board-section">
        <ActivityBoard />
      </div>

      <div className="hp-container">
        
        {/* ✅ REFACTORED HERO CARD */}
        <div className="hp-hero-card">
          <div className="hp-hero-content">
            <div className="hp-hero-badge">🎟️ The Festival is Open</div>
            <h1 className="hp-hero-title">
              Welcome to <span className="hp-text-gradient">Ppopgi (뽑기)</span>
            </h1>
            <p className="hp-hero-sub">
              Where fun meets fairness. Experience the thrill of fully transparent, on-chain lotteries. No tricks — just luck.
            </p>
            <div className="hp-hero-actions">
              <button className="hp-btn-primary" onClick={() => navigateFromHome("explore")}>
                Explore Lotteries
              </button>
              <button className="hp-btn-secondary" onClick={() => navigateFromHome("faq")}>
                How it Works
              </button>
            </div>
          </div>

          <div className="hp-stats-dock">
            <div className="hp-stat-item">
              <div className="hp-stat-val">{isLoading ? "..." : stats.totalLotteries}</div>
              <div className="hp-stat-lbl">Lotteries Created</div>
            </div>
            <div className="hp-stat-sep" />
            <div className="hp-stat-item">
              <div className="hp-stat-val">{isLoading ? "..." : fmtUsd(stats.settledVolume)}</div>
              <div className="hp-stat-lbl">Prizes Settled</div>
            </div>
            <div className="hp-stat-sep" />
            <div className="hp-stat-item highlight">
              <div className="hp-stat-val">{isLoading ? "..." : fmtUsd(stats.activeVolume)}</div>
              <div className="hp-stat-lbl">Active Volume</div>
            </div>
          </div>
        </div>

        {/* PODIUM */}
        <div className="hp-podium-section">
          <div className="hp-section-header" style={{ justifyContent: "center", marginBottom: 50 }}>
            <div className="hp-section-title">🏆 Top Active Prizepools</div>
          </div>

          <div className="hp-podium">
            {isLoading && (
              <>
                <div className="pp-silver-wrapper"><LotteryCardSkeleton /></div>
                <div className="pp-gold-wrapper"><LotteryCardSkeleton /></div>
                <div className="pp-bronze-wrapper"><LotteryCardSkeleton /></div>
              </>
            )}

            {!isLoading && podium.silver && (
              <div className="pp-silver-wrapper">
                <div className="pp-rank-badge silver">2</div>
                <LotteryCard lottery={podium.silver} onOpen={onOpenLottery} onOpenSafety={onOpenSafety} ribbon="silver" nowMs={nowMs} finalizer={finalizerForCards} />
              </div>
            )}
            {!isLoading && podium.gold && (
              <div className="pp-gold-wrapper">
                <div className="pp-rank-badge gold">1</div>
                <LotteryCard lottery={podium.gold} onOpen={onOpenLottery} onOpenSafety={onOpenSafety} ribbon="gold" nowMs={nowMs} finalizer={finalizerForCards} />
              </div>
            )}
            {!isLoading && podium.bronze && (
              <div className="pp-bronze-wrapper">
                <div className="pp-rank-badge bronze">3</div>
                <LotteryCard lottery={podium.bronze} onOpen={onOpenLottery} onOpenSafety={onOpenSafety} ribbon="bronze" nowMs={nowMs} finalizer={finalizerForCards} />
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
            {!endingEdges.atLeft && (
              <button className="hp-strip-arrow left" onClick={() => scrollStrip(endingRef.current, "left")}>‹</button>
            )}
            {!endingEdges.atRight && (
              <button className="hp-strip-arrow right" onClick={() => scrollStrip(endingRef.current, "right")}>›</button>
            )}

            <div className="hp-strip" ref={endingRef} onScroll={updateEndingEdges}>
              {isLoading && Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="hp-strip-item"><LotteryCardSkeleton /></div>
              ))}

              {!isLoading && endingSoonSorted.map((r) => (
                <div key={r.id} className="hp-strip-item">
                  <LotteryCard lottery={r} onOpen={onOpenLottery} onOpenSafety={onOpenSafety} nowMs={nowMs} finalizer={finalizerForCards} />
                </div>
              ))}

              {!isLoading && endingSoonSorted.length === 0 && (
                <div className="hp-empty-msg">
                  <div className="hp-empty-icon">😴</div>
                  <div>No lotteries ending soon.</div>
                </div>
              )}
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
            {!settledEdges.atLeft && (
              <button className="hp-strip-arrow left" onClick={() => scrollStrip(settledRef.current, "left")}>‹</button>
            )}
            {!settledEdges.atRight && (
              <button className="hp-strip-arrow right" onClick={() => scrollStrip(settledRef.current, "right")}>›</button>
            )}

            <div className="hp-strip" ref={settledRef} onScroll={updateSettledEdges}>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="hp-strip-item"><LotteryCardSkeleton /></div>
              ))}

              {!isLoading && recentlySettledSorted.map((r) => (
                <div key={r.id} className="hp-strip-item">
                  <LotteryCard lottery={r} onOpen={onOpenLottery} onOpenSafety={onOpenSafety} nowMs={nowMs} finalizer={finalizerForCards} />
                </div>
              ))}

              {!isLoading && recentlySettledSorted.length === 0 && (
                <div className="hp-empty-msg">
                  <div className="hp-empty-icon">📂</div>
                  <div>No recently settled lotteries yet.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
