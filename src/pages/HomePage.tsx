// src/pages/HomePage.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { formatUnits } from "ethers";
import { useHomeLotteries } from "../hooks/useHomeLotteries";
import { useInfraStatus } from "../hooks/useInfraStatus";
import { useGlobalStatsBillboard } from "../hooks/useGlobalStatsBillboard";
import { LotteryCard } from "../components/LotteryCard";
import { LotteryCardSkeleton } from "../components/LotteryCardSkeleton";
import { ActivityBoard } from "../components/ActivityBoard";
import "./HomePage.css";

type Props = {
  nowMs: number;
  onOpenLottery: (id: string) => void;
  onOpenSafety: (id: string) => void;

  // ✅ NEW: sign-in gate wiring
  isSignedIn: boolean;
  onOpenSignIn: () => void;
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
  { id: "cashier", text: "💡 Pro tip: Visit the Cashier to buy more XTZ or USDC", action: openCashierFromHome },
  { id: "explore", text: "🔎 Discover all lotteries from the Explore page", action: () => navigateFromHome("explore") },
  { id: "dashboard", text: "🎁 Visit your dashboard to reclaim prizes or tickets", action: () => navigateFromHome("dashboard") },
  { id: "about", text: "📖 Read the story behind Ppopgi (뽑기)", action: () => navigateFromHome("about") },
  { id: "faq", text: "❓ Learn how Ppopgi (뽑기) works (FAQ)", action: () => navigateFromHome("faq") },
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

/**
 * ✅ Billboard stat animation:
 * - First render animates from 0 -> target (slow start, fast finish)
 * - Subsequent updates animate from current -> next (for live updates)
 */
function useAnimatedNumber(target: number, durationMs = 900) {
  const [value, setValue] = useState(0);
  const prevRef = useRef(0);
  const firstRef = useRef(true);

  useEffect(() => {
    const to = Number.isFinite(target) ? target : 0;
    const from = firstRef.current ? 0 : prevRef.current;

    firstRef.current = false;
    prevRef.current = to;

    if (from === to) {
      setValue(to);
      return;
    }

    const start = performance.now();

    const tick = (now: number) => {
      const p = Math.min((now - start) / durationMs, 1);

      // ✅ Ease-in (slow at the beginning, faster near the end)
      const eased = p * p * p;

      const next = Math.round(from + (to - from) * eased);
      setValue(next);
      if (p < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }, [target, durationMs]);

  return value;
}

export function HomePage({
  nowMs,
  onOpenLottery,
  onOpenSafety,
  isSignedIn,
  onOpenSignIn,
}: Props) {
  useEffect(() => {
    document.title = "Ppopgi 뽑기 — Home";
  }, []);

  const infra = useInfraStatus();
  const { bigPrizes, endingSoon, recentlyFinalized, isLoading, refetch } = useHomeLotteries();

  // ✅ Billboard uses subgraph GlobalStats singleton (via your cache worker)
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

  const billboardLoading = gs.isLoading && !gs.data;

  const totalLotteriesTarget = Number(gs.data?.totalLotteriesCreated ?? 0n);
  const totalTicketsTarget = Number(gs.data?.totalTicketsSold ?? 0n);

  const settledUsdTarget = Number((gs.data?.totalPrizesSettledUSDC ?? 0n) / 1_000_000n);
  const activeUsdTarget = Number((gs.data?.activeVolumeUSDC ?? 0n) / 1_000_000n);

  const settledCountTarget = Number(gs.data?.totalLotteriesSettled ?? 0n);
  const canceledCountTarget = Number(gs.data?.totalLotteriesCanceled ?? 0n);

  const animatedLotteries = useAnimatedNumber(billboardLoading ? 0 : totalLotteriesTarget, 900);
  const animatedTickets = useAnimatedNumber(billboardLoading ? 0 : totalTicketsTarget, 900);
  const animatedSettledUsd = useAnimatedNumber(billboardLoading ? 0 : settledUsdTarget, 1000);
  const animatedActiveUsd = useAnimatedNumber(billboardLoading ? 0 : activeUsdTarget, 1000);
  const animatedSettledCount = useAnimatedNumber(billboardLoading ? 0 : settledCountTarget, 800);
  const animatedCanceledCount = useAnimatedNumber(billboardLoading ? 0 : canceledCountTarget, 800);

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
        {/* ... billboard unchanged ... */}

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
                  isSignedIn={isSignedIn}
                  onOpenSignIn={onOpenSignIn}
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
                  isSignedIn={isSignedIn}
                  onOpenSignIn={onOpenSignIn}
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
                  isSignedIn={isSignedIn}
                  onOpenSignIn={onOpenSignIn}
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
            <div className="hp-strip" ref={endingRef} onScroll={updateEndingEdges}>
              {!isLoading &&
                endingSoonSorted.map((r) => (
                  <div key={r.id} className="hp-strip-item">
                    <LotteryCard
                      lottery={r}
                      onOpen={onOpenLottery}
                      onOpenSafety={onOpenSafety}
                      nowMs={nowMs}
                      finalizer={finalizerForCards}
                      isSignedIn={isSignedIn}
                      onOpenSignIn={onOpenSignIn}
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
            <div className="hp-strip" ref={settledRef} onScroll={updateSettledEdges}>
              {!isLoading &&
                recentlySettledSorted.map((r) => (
                  <div key={r.id} className="hp-strip-item">
                    <LotteryCard
                      lottery={r}
                      onOpen={onOpenLottery}
                      onOpenSafety={onOpenSafety}
                      nowMs={nowMs}
                      finalizer={finalizerForCards}
                      isSignedIn={isSignedIn}
                      onOpenSignIn={onOpenSignIn}
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