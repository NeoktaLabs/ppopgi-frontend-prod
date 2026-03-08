import { useEffect, useMemo, useRef, useState } from "react";
import { useHomeLotteries } from "../hooks/useHomeLotteries";
import { useFinalizerStatus } from "../hooks/useFinalizerStatus";
import { useGlobalStatsBillboard } from "../hooks/useGlobalStatsBillboard";
import { LotteryCard } from "../components/LotteryCard";
import { LotteryCardSkeleton } from "../components/LotteryCardSkeleton";
import { ActivityBoard } from "../components/ActivityBoard";
import "./HomePage.css";

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

function fmtUSDC(v: bigint | number | string, opts?: { decimals?: number; maxFrac?: number }) {
  const decimals = opts?.decimals ?? 6;
  const maxFrac = opts?.maxFrac ?? 0;

  try {
    const x =
      typeof v === "bigint"
        ? v
        : BigInt(typeof v === "number" ? Math.trunc(v) : String(v || "0").trim() || "0");

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

function fmtCountdown(totalSec: number | null | undefined) {
  if (totalSec == null) return "—";

  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(r)}s`;
  return `${r}s`;
}

type Props = {
  onOpenLottery: (id: string) => void;
  onOpenSafety: (id: string) => void;
};

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const JUST_FINISHED_WINDOW_MS = 10000;
const RECENT_OK_FINISH_GAP_MS = 15000;

function openCashierFromHome() {
  try {
    window.dispatchEvent(new CustomEvent("ppopgi:open-cashier"));
  } catch {}
}

function navigateFromHome(page: "explore" | "faq" | "dashboard" | "about") {
  try {
    window.dispatchEvent(new CustomEvent("ppopgi:navigate", { detail: { page } }));
  } catch {}
}

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

function HeroSpiritTypewriter() {
  const line1 = "where players risk small for a chance to win bigger";
  const line2 = "and creators build their prize pools from ticket sales";

  const [text1, setText1] = useState("");
  const [text2, setText2] = useState("");
  const [phase, setPhase] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    if (phase === 1) {
      if (text1.length < line1.length) {
        const t = setTimeout(() => setText1(line1.slice(0, text1.length + 1)), 28);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setPhase(2), 350);
      return () => clearTimeout(t);
    }

    if (phase === 2) {
      if (text2.length < line2.length) {
        const t = setTimeout(() => setText2(line2.slice(0, text2.length + 1)), 28);
        return () => clearTimeout(t);
      }
      setPhase(3);
    }
  }, [phase, text1, text2]);

  return (
    <div className="hp-hero-typer">
      <div className="hp-hero-typer-line">
        {text1}
        {phase === 1 && <span className="hp-hero-caret" />}
      </div>
      <div className="hp-hero-typer-line">
        {text2}
        {phase === 2 && <span className="hp-hero-caret" />}
      </div>
    </div>
  );
}

export function HomePage({ onOpenLottery, onOpenSafety }: Props) {
  useEffect(() => {
    document.title = "Ppopgi 뽑기 — Home";
  }, []);

  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const finalizer = useFinalizerStatus();
  const { bigPrizes, endingSoon, recentlyFinalized, isLoading, refetch } = useHomeLotteries();
  const gs = useGlobalStatsBillboard();

  const finalizerForCards = useMemo(
    () => ({
      running: !!finalizer.running,
      secondsToNextRun: finalizer.secondsToNextRun ?? null,
      tsMs: finalizer.tsMs,
    }),
    [finalizer.running, finalizer.secondsToNextRun, finalizer.tsMs]
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
    if (!bigPrizes || bigPrizes.length === 0) {
      return { gold: null, silver: null, bronze: null };
    }

    const sorted = [...bigPrizes].sort((a, b) => {
      try {
        return BigInt(a.winningPot || "0") < BigInt(b.winningPot || "0") ? 1 : -1;
      } catch {
        return 0;
      }
    });

    return {
      gold: sorted[0] || null,
      silver: sorted[1] || null,
      bronze: sorted[2] || null,
    };
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

  const stats = useMemo(() => {
    if (!gs.data) return null;
    return {
      tix: fmtInt(gs.data.totalTicketsSold),
      lots: fmtInt(gs.data.totalLotteriesCreated),
      activeUsd: fmtUSDC(gs.data.activeVolumeUSDC, { maxFrac: 0 }),
      settledUsd: fmtUSDC(gs.data.totalPrizesSettledUSDC, { maxFrac: 0 }),
    };
  }, [gs.data]);

  const justCompletedSuccess = useMemo(() => {
    if (finalizer.error) return false;
    if (finalizer.running) return false;
    if (finalizer.status !== "ok") return false;
    if (finalizer.lastFinishedMs == null) return false;
    if (finalizer.lastOkMs == null) return false;
    if (Math.abs(finalizer.lastFinishedMs - finalizer.lastOkMs) > RECENT_OK_FINISH_GAP_MS) return false;
    return nowMs - finalizer.lastFinishedMs <= JUST_FINISHED_WINDOW_MS;
  }, [
    finalizer.error,
    finalizer.running,
    finalizer.status,
    finalizer.lastFinishedMs,
    finalizer.lastOkMs,
    nowMs,
  ]);

  const justCompletedError = useMemo(() => {
    if (finalizer.error) return false;
    if (finalizer.running) return false;
    if (finalizer.lastRunMs == null) return false;
    if (finalizer.lastFinishedMs == null) return false;

    const failed = finalizer.status === "error" || !!finalizer.lastError;
    if (!failed) return false;

    return nowMs - finalizer.lastFinishedMs <= JUST_FINISHED_WINDOW_MS;
  }, [
    finalizer.error,
    finalizer.running,
    finalizer.lastRunMs,
    finalizer.lastFinishedMs,
    finalizer.status,
    finalizer.lastError,
    nowMs,
  ]);

  const finalizerTone = useMemo(() => {
    if (finalizer.error) return "warn";
    if (finalizer.running) return "live";
    if (justCompletedSuccess) return "done";
    if (justCompletedError) return "fail";
    if (finalizer.secondsToNextRun === 0) return "soon";
    return "idle";
  }, [
    finalizer.error,
    finalizer.running,
    justCompletedSuccess,
    justCompletedError,
    finalizer.secondsToNextRun,
  ]);

  const finalizerStat = useMemo(() => {
    if (finalizer.error) {
      return {
        isText: true,
        value: "Unavailable",
        kicker: "Draw monitor",
        label: "We’re having trouble checking the next draw.",
      };
    }

    if (finalizer.running) {
      return {
        isText: true,
        value: "Drawing winners! 🎰",
        kicker: "Live draw in progress",
        label: "Lucky tickets are being picked on-chain right now.",
      };
    }

    if (justCompletedSuccess) {
      return {
        isText: true,
        value: "Draw completed ✅",
        kicker: "Latest draw completed",
        label: "Eligible lotteries were just processed on-chain.",
      };
    }

    if (justCompletedError) {
      return {
        isText: true,
        value: "An error occurred",
        kicker: "Latest draw failed",
        label: "The latest finalizer run did not complete successfully.",
      };
    }

    if (finalizer.secondsToNextRun == null) {
      return {
        isText: true,
        value: "—",
        kicker: "Draw monitor",
        label: "Awaiting next draw schedule.",
      };
    }

    if (finalizer.secondsToNextRun === 0) {
      return {
        isText: true,
        value: "Any moment now ✨",
        kicker: "Draw almost ready",
        label: "One or more eligible lotteries are about to be processed.",
      };
    }

    return {
      isText: false,
      value: fmtCountdown(finalizer.secondsToNextRun),
      kicker: "Next Ppopgi draw",
      label: (
        <span className="hp-cd-label-inner">
          <span className="hp-tooltip-wrap" tabIndex={0}>
            <span className="hp-tooltip-text">Eligible lotteries</span>
            <span className="hp-info-icon">i</span>
            <span className="hp-tooltip">
              Eligible lotteries include the ones with deadline reached or max tickets sold.
            </span>
          </span>
          <span>will be drawn in:</span>
        </span>
      ),
    };
  }, [
    finalizer.error,
    finalizer.running,
    finalizer.secondsToNextRun,
    justCompletedSuccess,
    justCompletedError,
  ]);

  return (
    <>
      <div className="hp-announcement-bar hp-announcement-top">
        <BannerSlider />
      </div>

      <div className="hp-hero-card hp-billboard">
        <div className="hp-billboard-bg" />
        <div className="hp-billboard-sparkles" />

        <div className="hp-hero-content">
          <div className="hp-badge-shimmer">
            <div className="hp-hero-badge">✨ The Fair On-Chain Lottery</div>
          </div>

          <div className="hp-hero-title">
            Welcome to <br className="hp-mobile-break" />
            <span className="hp-text-gradient">Ppopgi (뽑기)</span>
          </div>

          <div className="hp-hero-sub hp-hero-sub-typer">
            <HeroSpiritTypewriter />
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

        {stats && (
          <div className="hp-stats-dock">
            <div className="hp-stats-title-wrap">
              <div className="hp-stats-title">Live Ppopgi (뽑기) Stats</div>
            </div>

            <div className="hp-stats-row">
              <div className="hp-stat-item highlight">
                <div className="hp-stat-val">{stats.tix}</div>
                <div className="hp-stat-lbl">Tickets Sold</div>
              </div>

              <div className="hp-stat-sep" />

              <div className="hp-stat-item">
                <div className="hp-stat-val">{stats.lots}</div>
                <div className="hp-stat-lbl">Lotteries Created</div>
              </div>

              <div className="hp-stat-sep" />

              <div className="hp-stat-item">
                <div className="hp-stat-val">{stats.activeUsd}</div>
                <div className="hp-stat-lbl">Active Volume</div>
              </div>

              <div className="hp-stat-sep" />

              <div className="hp-stat-item">
                <div className="hp-stat-val">{stats.settledUsd}</div>
                <div className="hp-stat-lbl">Prizes Settled</div>
              </div>
            </div>
          </div>
        )}

        <div className="hp-stats-countdown-wrap">
          <div className={`hp-cd-card is-${finalizerTone}`}>
            <div className="hp-cd-top">
              <div className="hp-cd-badge">
                <span className="hp-cd-badge-dot" />
                {finalizerStat.kicker}
              </div>
            </div>

            <div className="hp-cd-main">
              <div className="hp-cd-icon-wrap">
                {finalizer.running ? "🎰" : justCompletedSuccess ? "✅" : justCompletedError ? "⚠️" : "⏳"}
              </div>

              <div className="hp-cd-copy">
                <div className="hp-cd-label">{finalizerStat.label}</div>

                <div
                  className={`hp-cd-display ${
                    finalizer.running ? "is-running" : ""
                  } ${finalizer.error || justCompletedError ? "is-error" : ""} ${
                    justCompletedSuccess ? "is-success" : ""
                  }`}
                >
                  <span
                    className={`hp-cd-val ${finalizerStat.isText ? "text-mode" : "timer-mode"} ${
                      finalizer.running ? "pulse" : ""
                    } ${justCompletedSuccess ? "success-mode" : ""} ${justCompletedError ? "error-mode" : ""}`}
                  >
                    {finalizerStat.isText ? (
                      finalizerStat.value
                    ) : (
                      finalizerStat.value.split("").map((char, index) => (
                        <span
                          key={`${index}-${char}`}
                          className={/[0-9]/.test(char) ? "cd-flip-char" : "cd-static-char"}
                        >
                          {char}
                        </span>
                      ))
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="hp-hero-attach">
        <div className="hp-hero-attach-card">
          <ActivityBoard />
        </div>
      </div>

      <div className="hp-container">
        <div className="hp-podium-section">
          <div className="hp-section-header" style={{ justifyContent: "center", marginBottom: 50 }}>
            <div className="hp-section-title">🏆 Top Active Prizepools</div>
          </div>

          <div className="hp-podium">
            {isLoading && (
              <>
                <LotteryCardSkeleton />
                <LotteryCardSkeleton />
                <LotteryCardSkeleton />
              </>
            )}

            {!isLoading &&
              podium.gold && (
                <div className="pp-gold-wrapper">
                  <div className="pp-rank-badge gold">1</div>
                  <LotteryCard
                    lottery={podium.gold}
                    ribbon="gold"
                    nowMs={nowMs}
                    finalizer={finalizerForCards}
                    onOpen={onOpenLottery}
                    onOpenSafety={onOpenSafety}
                  />
                </div>
              )}

            {!isLoading &&
              podium.silver && (
                <div className="pp-silver-wrapper">
                  <div className="pp-rank-badge silver">2</div>
                  <LotteryCard
                    lottery={podium.silver}
                    ribbon="silver"
                    nowMs={nowMs}
                    finalizer={finalizerForCards}
                    onOpen={onOpenLottery}
                    onOpenSafety={onOpenSafety}
                  />
                </div>
              )}

            {!isLoading &&
              podium.bronze && (
                <div className="pp-bronze-wrapper">
                  <div className="pp-rank-badge bronze">3</div>
                  <LotteryCard
                    lottery={podium.bronze}
                    ribbon="bronze"
                    nowMs={nowMs}
                    finalizer={finalizerForCards}
                    onOpen={onOpenLottery}
                    onOpenSafety={onOpenSafety}
                  />
                </div>
              )}
          </div>
        </div>

        <div>
          <div className="hp-section-header">
            <div className="hp-section-title">⏳ Ending Soon</div>
            <div className="hp-section-line" />
          </div>

          <div className="hp-strip-wrap">
            <div className="hp-strip" ref={endingRef}>
              {endingSoonSorted.map((r) => (
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

        <div>
          <div className="hp-section-header">
            <div className="hp-section-title">✅ Recently Finalized</div>
            <div className="hp-section-line" />
          </div>

          <div className="hp-strip-wrap">
            <div className="hp-strip" ref={settledRef}>
              {recentlySettledSorted.map((r) => (
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