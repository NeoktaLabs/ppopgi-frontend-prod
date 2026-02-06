// src/components/ActivityBoard.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { formatUnits } from "ethers";
import { fetchGlobalActivity, type GlobalActivityItem } from "../indexer/subgraph";
import "./ActivityBoard.css";

const short = (s: string) => (s ? `${s.slice(0, 4)}...${s.slice(-4)}` : "—");

const timeAgo = (ts: string) => {
  const diff = Math.floor(Date.now() / 1000) - Number(ts);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
};

function isHidden() {
  try {
    return typeof document !== "undefined" && document.hidden;
  } catch {
    return false;
  }
}

function parseHttpStatus(err: any): number | null {
  const msg = String(err?.message || err || "");
  const m = msg.match(/SUBGRAPH_HTTP_ERROR_(\d{3})/);
  return m ? Number(m[1]) : null;
}

function isRateLimitError(err: any) {
  const status = parseHttpStatus(err);
  if (status === 429 || status === 503) return true;

  const msg = String(err?.message ?? err ?? "").toLowerCase();
  return msg.includes("429") || msg.includes("too many requests") || msg.includes("rate limit");
}

export function ActivityBoard() {
  const [items, setItems] = useState<GlobalActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- polling controls ----
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const backoffStepRef = useRef(0);

  // ✅ setTimeout-based scheduler so we can adapt interval/backoff
  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNext = useCallback((ms: number) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      void load(true);
    }, ms);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ✅ dynamic load function with backoff + hidden-tab slow-down
  const load = useCallback(
    async (isBackground = false) => {
      // slow down aggressively in background (especially mobile)
      if (isBackground && isHidden()) {
        scheduleNext(60_000);
        return;
      }

      if (inFlightRef.current) return;
      inFlightRef.current = true;

      // Only show loader on cold start (avoid flicker)
      if (!isBackground && items.length === 0) setLoading(true);

      try {
        const data = await fetchGlobalActivity({ first: 10 });

        setItems(data);
        setLoading(false);

        // success: reset backoff
        backoffStepRef.current = 0;

        // normal cadence:
        // - foreground: 20s
        // - background: 45s
        scheduleNext(isBackground ? 45_000 : 20_000);
      } catch (e) {
        console.error("[ActivityBoard] load failed", e);

        // if rate-limited: exponential backoff up to 3 minutes
        if (isRateLimitError(e)) {
          backoffStepRef.current = Math.min(backoffStepRef.current + 1, 5);
          const delays = [20_000, 30_000, 60_000, 120_000, 180_000, 180_000];
          scheduleNext(delays[backoffStepRef.current]);
        } else {
          // non-rate errors: just slow down a bit
          scheduleNext(isBackground ? 60_000 : 30_000);
        }

        // Don’t wipe UI on background errors; only stop loader if it was still loading
        setLoading(false);
      } finally {
        inFlightRef.current = false;
      }
    },
    [items.length, scheduleNext]
  );

  useEffect(() => {
    void load(false);

    const onFocus = () => void load(true);
    const onVis = () => {
      if (!isHidden()) void load(true);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      clearTimer();
    };
  }, [load]);

  if (loading && items.length === 0) {
    return (
      <div className="ab-board">
        <div className="ab-loading">Loading...</div>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="ab-board">
      <div className="ab-header">
        <div className="ab-pulse" />
        Live Feed (Last 10)
      </div>

      <div className="ab-list">
        {items.map((item, i) => {
          // Keep robust if you later add WIN/CANCEL types
          const isBuy = item.type === "BUY";
          const isCreate = item.type === "CREATE";
          const isWin = (item as any).type === "WIN";
          const isCancel = (item as any).type === "CANCEL";

          let icon = "✨";
          let iconClass = "create";
          if (isBuy) {
            icon = "🎟️";
            iconClass = "buy";
          }
          if (isWin) {
            icon = "🏆";
            iconClass = "win";
          }
          if (isCancel) {
            icon = "⛔";
            iconClass = "cancel";
          }

          return (
            <div key={`${item.txHash}-${i}`} className="ab-row">
              <div className={`ab-icon ${iconClass}`}>{icon}</div>

              <div className="ab-content">
                <div className="ab-main-text">
                  {/* ✅ CANCEL message: human-friendly sentence, no address prefix */}
                  {isCancel ? (
                    <>
                      <a href={`/?raffle=${item.raffleId}`} className="ab-link">
                        {item.raffleName}
                      </a>{" "}
                      got <b style={{ color: "#991b1b" }}>canceled</b> due to min ticket not reached
                    </>
                  ) : (
                    <>
                      <a
                        href={`https://explorer.etherlink.com/address/${item.subject}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ab-user"
                      >
                        {short(item.subject)}
                      </a>

                      {isBuy && (
                        <>
                          {" "}
                          bought <b>{item.value} tix</b> in{" "}
                        </>
                      )}
                      {isCreate && <> created </>}
                      {isWin && (
                        <>
                          {" "}
                          <b style={{ color: "#166534" }}>won</b> the pot on{" "}
                        </>
                      )}

                      <a href={`/?raffle=${item.raffleId}`} className="ab-link">
                        {item.raffleName}
                      </a>
                    </>
                  )}
                </div>

                <div className="ab-meta">
                  <span className="ab-time">{timeAgo(item.timestamp)}</span>

                  {/* Keep original “pot” tag behavior but don’t assume cancel has value */}
                  {!isBuy && (
                    <span className={`ab-pot-tag ${isWin ? "win" : isCancel ? "cancel" : ""}`}>
                      {isWin ? "Won: " : isCancel ? "Refunded" : "Pot: "}
                      {!isCancel && formatUnits(item.value, 6)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}