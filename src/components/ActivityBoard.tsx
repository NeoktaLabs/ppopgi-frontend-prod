// src/components/ActivityBoard.tsx
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { formatUnits } from "ethers";
import { fetchGlobalActivity, type GlobalActivityItem } from "../indexer/subgraph";
import "./ActivityBoard.css";

const short = (s: string) => (s ? `${s.slice(0, 4)}...${s.slice(-4)}` : "—");

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

function isFresh(ts: string, seconds = 10) {
  const now = Math.floor(Date.now() / 1000);
  const t = Number(ts || "0");
  if (!Number.isFinite(t) || t <= 0) return false;
  return now - t <= seconds;
}

function timeAgoFrom(nowSec: number, ts: string) {
  const diff = nowSec - Number(ts);
  if (!Number.isFinite(diff)) return "—";
  if (diff < 0) return "0s";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

export function ActivityBoard() {
  const [items, setItems] = useState<GlobalActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  // ✅ 1s ticker (UI-only) so "time ago" updates without hammering the indexer
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(t);
  }, []);

  // ✅ Track which events have been seen to play enter animation once
  // Use txHash as stable identity (order can change between polls)
  const seenRef = useRef<Set<string>>(new Set());

  // ---- polling controls ----
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const backoffStepRef = useRef(0);

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

  /**
   * ✅ Network polling (cheap):
   * - Foreground normal: 20s
   * - Background/hidden: 60s
   * - Rate limit: exponential backoff up to 180s
   */
  const load = useCallback(
    async (isBackground = false) => {
      // Slow down aggressively when hidden
      if (isBackground && isHidden()) {
        scheduleNext(60_000);
        return;
      }

      if (inFlightRef.current) return;
      inFlightRef.current = true;

      // Only show loader on cold start
      if (!isBackground && items.length === 0) setLoading(true);

      try {
        const data = await fetchGlobalActivity({ first: 10 });
        const next = data ?? [];

        setItems(next);
        setLoading(false);

        // success: reset backoff
        backoffStepRef.current = 0;

        // normal cadence
        scheduleNext(isBackground ? 45_000 : 20_000);
      } catch (e) {
        console.error("[ActivityBoard] load failed", e);

        if (isRateLimitError(e)) {
          backoffStepRef.current = Math.min(backoffStepRef.current + 1, 5);
          const delays = [20_000, 30_000, 60_000, 120_000, 180_000, 180_000];
          scheduleNext(delays[backoffStepRef.current]);
        } else {
          scheduleNext(isBackground ? 60_000 : 30_000);
        }

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

  // ✅ Compute enter animation flags (only first time txHash appears)
  const rowsWithFlags = useMemo(() => {
    return (items ?? []).map((it) => {
      const stableKey = String(it.txHash || "");
      const already = stableKey ? seenRef.current.has(stableKey) : false;
      const enter = stableKey ? !already : false;

      if (stableKey && !already) seenRef.current.add(stableKey);

      // key must be unique even if txHash missing (should be rare)
      const reactKey = stableKey || `${it.type}-${it.raffleId}-${it.timestamp}-${it.subject}`;

      return { it, key: reactKey, enter };
    });
  }, [items]);

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
        {rowsWithFlags.map(({ it: item, key, enter }) => {
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

          const fresh = isFresh(item.timestamp, 10);

          const rowClass = [
            "ab-row",
            enter ? "ab-enter" : "",
            fresh ? `ab-fresh ab-fresh-${iconClass}` : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div key={key} className={rowClass}>
              <div className={`ab-icon ${iconClass}`}>{icon}</div>

              <div className="ab-content">
                <div className="ab-main-text">
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
                  <span className="ab-time">
                    {timeAgoFrom(nowSec, item.timestamp)}
                    {fresh && <span className="ab-new-pill">NEW</span>}
                  </span>

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

export default ActivityBoard;