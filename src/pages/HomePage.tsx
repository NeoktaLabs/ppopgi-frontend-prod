// src/pages/HomePage.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { formatUnits } from "ethers";
import { useHomeRaffles } from "../hooks/useHomeRaffles";
import { RaffleCard } from "../components/RaffleCard";
import { RaffleCardSkeleton } from "../components/RaffleCardSkeleton";
import { ActivityBoard } from "../components/ActivityBoard";
import "./HomePage.css";

type Props = {
  nowMs: number;
  onOpenRaffle: (id: string) => void;
  onOpenSafety: (id: string) => void;
};

// Formatting Helper (Compact USD)
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
  const eps = 2; // small tolerance for fractional pixels
  return {
    atLeft: left <= eps,
    atRight: left >= maxLeft - eps,
  };
}

export function HomePage({ nowMs, onOpenRaffle, onOpenSafety }: Props) {
  useEffect(() => {
    document.title = "Ppopgi 뽑기 — Home";
  }, []);

  const { bigPrizes, endingSoon, recentlyFinalized, stats, isLoading } = useHomeRaffles();

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

  // Podium Logic
  const podium = useMemo(() => {
    if (!bigPrizes || bigPrizes.length === 0) return { gold: null, silver: null, bronze: null };

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

  // Ending Soon Logic
  const endingSoonSorted = useMemo(() => {
    if (!endingSoon) return [];
    return [...endingSoon].sort((a, b) => num(a.deadline) - num(b.deadline));
  }, [endingSoon]);

  // Recently Settled (already sorted in hook, but keep stable + ensure max 5)
  const recentlySettledSorted = useMemo(() => {
    return (recentlyFinalized ?? []).slice(0, 5);
  }, [recentlyFinalized]);

  // Initialize / refresh arrow visibility when lists load or resize
  useEffect(() => {
    const tick = () => {
      updateEndingEdges();
      updateSettledEdges();
    };

    // Run after paint to ensure scrollWidth is correct
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
      {/* BOARD SECTION */}
      <div className="hp-board-section">
        <ActivityBoard />
      </div>

      <div className="hp-container">
        {/* 1. HERO */}
        <div className="hp-hero">
          <h1 className="hp-hero-title">Welcome to Ppopgi (뽑기)</h1>
          <div className="hp-hero-sub">
            Where fun meets fairness. Experience the thrill of fully transparent, on-chain raffles. No tricks — just luck.
          </div>

          {/* STATS BAR */}
          <div className="hp-stats-bar">
            <div className="hp-stat-item">
              <div className="hp-stat-val">{isLoading ? "..." : stats.totalRaffles}</div>
              <div className="hp-stat-lbl">Raffles Created</div>
            </div>

            <div className="hp-stat-sep" />

            <div className="hp-stat-item">
              <div className="hp-stat-val">{isLoading ? "..." : fmtUsd(stats.settledVolume)}</div>
              <div className="hp-stat-lbl">Prizes Settled</div>
            </div>

            <div className="hp-stat-sep" />

            <div className="hp-stat-item highlight">
              <div className="hp-stat-val">{isLoading ? "..." : fmtUsd(stats.activeVolume)}</div>
              <div className="hp-stat-lbl">Total Active Volume</div>
            </div>
          </div>
        </div>

        {/* 2. PODIUM */}
        <div className="hp-podium-section">
          <div className="hp-section-header" style={{ justifyContent: "center", marginBottom: 40 }}>
            <div className="hp-section-title">🏆 Top Active Prizepools</div>
          </div>

          <div className="hp-podium">
            {isLoading && (
              <>
                <div className="pp-silver-wrapper">
                  <RaffleCardSkeleton />
                </div>
                <div className="pp-gold-wrapper">
                  <RaffleCardSkeleton />
                </div>
                <div className="pp-bronze-wrapper">
                  <RaffleCardSkeleton />
                </div>
              </>
            )}

            {!isLoading && podium.silver && (
              <div className="pp-silver-wrapper">
                <RaffleCard raffle={podium.silver} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} ribbon="silver" nowMs={nowMs} />
              </div>
            )}

            {!isLoading && podium.gold && (
              <div className="pp-gold-wrapper">
                <RaffleCard raffle={podium.gold} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} ribbon="gold" nowMs={nowMs} />
              </div>
            )}

            {!isLoading && podium.bronze && (
              <div className="pp-bronze-wrapper">
                <RaffleCard raffle={podium.bronze} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} ribbon="bronze" nowMs={nowMs} />
              </div>
            )}

            {!isLoading && !podium.gold && !podium.silver && !podium.bronze && (
              <div className="hp-empty-msg">No active raffles to display.</div>
            )}
          </div>
        </div>

        {/* 3. ENDING SOON */}
        <div>
          <div className="hp-section-header">
            <div className="hp-section-title">⏳ Ending Soon</div>
            <div className="hp-section-line" />
          </div>

          <div className="hp-strip-wrap">
            {!endingEdges.atLeft && (
              <button className="hp-strip-arrow left" onClick={() => scrollStrip(endingRef.current, "left")} aria-label="Scroll left">
                ‹
              </button>
            )}
            {!endingEdges.atRight && (
              <button className="hp-strip-arrow right" onClick={() => scrollStrip(endingRef.current, "right")} aria-label="Scroll right">
                ›
              </button>
            )}

            <div
              className="hp-strip"
              ref={endingRef}
              onScroll={updateEndingEdges}
            >
              {isLoading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="hp-strip-item">
                    <RaffleCardSkeleton />
                  </div>
                ))}

              {!isLoading &&
                endingSoonSorted.map((r) => (
                  <div key={r.id} className="hp-strip-item">
                    <RaffleCard raffle={r} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} nowMs={nowMs} />
                  </div>
                ))}

              {!isLoading && endingSoonSorted.length === 0 && <div className="hp-empty-msg">No raffles ending soon.</div>}
            </div>

            {!endingEdges.atLeft && <div className="hp-strip-fade left" />}
            {!endingEdges.atRight && <div className="hp-strip-fade right" />}
          </div>
        </div>

        {/* 4. RECENTLY SETTLED */}
        <div>
          <div className="hp-section-header">
            <div className="hp-section-title">✅ Recently Settled</div>
            <div className="hp-section-line" />
          </div>

          <div className="hp-strip-wrap">
            {!settledEdges.atLeft && (
              <button className="hp-strip-arrow left" onClick={() => scrollStrip(settledRef.current, "left")} aria-label="Scroll left">
                ‹
              </button>
            )}
            {!settledEdges.atRight && (
              <button className="hp-strip-arrow right" onClick={() => scrollStrip(settledRef.current, "right")} aria-label="Scroll right">
                ›
              </button>
            )}

            <div
              className="hp-strip"
              ref={settledRef}
              onScroll={updateSettledEdges}
            >
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="hp-strip-item">
                    <RaffleCardSkeleton />
                  </div>
                ))}

              {!isLoading &&
                recentlySettledSorted.map((r) => (
                  <div key={r.id} className="hp-strip-item">
                    <RaffleCard raffle={r} onOpen={onOpenRaffle} onOpenSafety={onOpenSafety} nowMs={nowMs} />
                  </div>
                ))}

              {!isLoading && recentlySettledSorted.length === 0 && (
                <div className="hp-empty-msg">No recently settled raffles yet.</div>
              )}
            </div>

            {!settledEdges.atLeft && <div className="hp-strip-fade left" />}
            {!settledEdges.atRight && <div className="hp-strip-fade right" />}
          </div>
        </div>
      </div>
    </>
  );
}