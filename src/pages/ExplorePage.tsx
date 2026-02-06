// src/pages/ExplorePage.tsx
import { useEffect } from "react";
import { RaffleCard } from "../components/RaffleCard";
import { RaffleCardSkeleton } from "../components/RaffleCardSkeleton";
import { useExploreController, type SortMode } from "../hooks/useExploreController";
import "./ExplorePage.css";


type Props = {
  onOpenRaffle: (id: string) => void;
  onOpenSafety: (id: string) => void;
};

export function ExplorePage({ onOpenRaffle, onOpenSafety }: Props) {
  
  useEffect(() => {
  document.title = "Ppopgi 뽑기 — Explore";
}, []);
  
  const { state, actions, meta } = useExploreController();

  const hasAnyItems = (state.items?.length ?? 0) > 0;
  const showSkeletons = meta.isLoading && !hasAnyItems;

  const showMyRafflesHint = state.myRafflesOnly && !state.me;

  return (
    <div style={{ padding: 0 }}>
      <div className="xp-wrapper">
        <div className="xp-inner-stroke" />
        <div className="xp-accent" />

        {/* Hero Section */}
        <div className="xp-header">
          <div>
            <div className="xp-title-pill">
              <span className="xp-dot" />
              🔎 Explore raffles
            </div>

            {state.note && (
              <div
                style={{
                  marginTop: 10,
                  paddingLeft: 18,
                  fontSize: 13,
                  fontWeight: 850,
                  opacity: 0.95,
                }}
              >
                {state.note}
              </div>
            )}

            {showMyRafflesHint && (
              <div
                style={{
                  marginTop: 8,
                  paddingLeft: 18,
                  fontSize: 12,
                  fontWeight: 800,
                  opacity: 0.8,
                }}
              >
                Sign in to use <b>My Raffles</b>.
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="xp-meta-tag">
              {meta.isLoading && !hasAnyItems ? "Syncing..." : `${meta.totalCount} raffles`}
            </span>
            <span className="xp-meta-tag">
              {meta.isLoading && !hasAnyItems ? "..." : `${meta.shownCount} shown`}
            </span>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="xp-controls">
          <div className="xp-panel">
            <div className="xp-panel-top">
              <span>Filters</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="xp-mini-btn"
                  onClick={() => actions.setQ("")}
                  title="Clear search"
                >
                  Clear
                </button>
                <button
                  className="xp-mini-btn primary"
                  onClick={actions.resetFilters}
                  title="Reset all"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="xp-toggles">
              <button
                className={`xp-pill-btn ${state.openOnly ? "active" : ""}`}
                onClick={() => actions.setOpenOnly(!state.openOnly)}
              >
                Open Only
              </button>

              <button
                className={`xp-pill-btn ${state.myRafflesOnly ? "active" : ""}`}
                onClick={() => actions.setMyRafflesOnly(!state.myRafflesOnly)}
                disabled={!state.me}
                title={!state.me ? "Sign in first" : "Show my created raffles"}
              >
                My Raffles
              </button>
            </div>

            <div className="xp-filter-grid">
              <div>
                <div className="xp-label">Search</div>
                <input
                  className="xp-input"
                  value={state.q}
                  onChange={(e) => actions.setQ(e.target.value)}
                  placeholder="Name or 0x address..."
                />
              </div>

              <div>
                <div className="xp-label">Status</div>
                <select
                  className="xp-input"
                  value={state.status}
                  onChange={(e) => actions.setStatus(e.target.value as any)}
                  style={{ cursor: "pointer" }}
                >
                  <option value="ALL">All</option>
                  <option value="OPEN">Open</option>
                  <option value="FUNDING_PENDING">Getting Ready</option>
                  <option value="DRAWING">Drawing</option>
                  <option value="COMPLETED">Settled</option>
                  <option value="CANCELED">Canceled</option>
                </select>
              </div>

              <div>
                <div className="xp-label">Sort</div>
                <select
                  className="xp-input"
                  value={state.sort}
                  onChange={(e) => actions.setSort(e.target.value as SortMode)}
                  style={{ cursor: "pointer" }}
                >
                  <option value="endingSoon">Ending Soon</option>
                  <option value="bigPrize">Big Prize</option>
                  <option value="newest">Newest</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Results List */}
        <div className="xp-results">
          {/* Skeleton only on true cold load */}
          {showSkeletons && (
            <>
              {Array.from({ length: 6 }).map((_, i) => (
                <RaffleCardSkeleton key={i} />
              ))}
            </>
          )}

          {/* Empty State */}
          {!meta.isLoading && state.list.length === 0 && (
            <div className="xp-empty">No raffles match your filters.</div>
          )}

          {/* Real Cards (show even if background syncing) */}
          {state.list.map((r) => (
            <RaffleCard
              key={r.id}
              raffle={r}
              onOpen={onOpenRaffle}
              onOpenSafety={onOpenSafety}
            />
          ))}
        </div>
      </div>
    </div>
  );
}