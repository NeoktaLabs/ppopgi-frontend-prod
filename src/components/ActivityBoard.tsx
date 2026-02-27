// src/components/ActivityBoard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "ethers";
import { useActivityStore } from "../hooks/useActivityStore";
import "./ActivityBoard.css";

// ✅ shared UI formatter (removes trailing .0 / trims zeros)
import { fmtUsdcUi } from "../lib/format";

const NEW_WINDOW_SEC = 30;

const shortAddr = (s: string) => (s ? `${s.slice(0, 4)}...${s.slice(-4)}` : "—");

function isFresh(ts: string, seconds = NEW_WINDOW_SEC) {
  const now = Math.floor(Date.now() / 1000);
  const t = Number(ts || "0");
  if (!Number.isFinite(t) || t <= 0) return false;
  return now - t <= seconds;
}

function timeAgoFrom(nowSec: number, ts: string) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return "—";

  const diff = nowSec - t;
  if (!Number.isFinite(diff)) return "—";
  if (diff < 0) return "0 sec ago";

  if (diff < 60) {
    const s = Math.floor(diff);
    return `${s} sec ago`;
  }

  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} min ago`;
  }

  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h}h ago`;
  }

  if (diff < 30 * 86400) {
    const d = Math.floor(diff / 86400);
    return `${d} day${d === 1 ? "" : "s"} ago`;
  }

  if (diff < 365 * 86400) {
    const mo = Math.floor(diff / (30 * 86400));
    return `${mo} month${mo === 1 ? "" : "s"} ago`;
  }

  const y = Math.floor(diff / (365 * 86400));
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

// Support both new + legacy item shapes
function getLotteryId(item: any): string {
  return String(item?.lotteryId || "");
}
function getLotteryName(item: any): string {
  return String(item?.lotteryName || "—");
}

function buildDetailHref(lotteryId: string) {
  const u = new URL("/", window.location.origin);
  if (lotteryId) u.searchParams.set("lottery", lotteryId);
  return u.toString();
}

function fmtUsdcFromU6(valueU6: string): string {
  const s = formatUnits(valueU6 || "0", 6);
  return fmtUsdcUi(s);
}

export function ActivityBoard() {
  const { items, isLoading } = useActivityStore();

  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(t);
  }, []);

  const seenRef = useRef<Set<string>>(new Set());

  const rowsWithFlags = useMemo(() => {
    return (items ?? []).map((it) => {
      const stableKey = String((it as any).txHash || "");
      const already = stableKey ? seenRef.current.has(stableKey) : false;
      const enter = stableKey ? !already : false;

      if (stableKey && !already) seenRef.current.add(stableKey);

      const reactKey =
        stableKey ||
        `${(it as any).type}-${getLotteryId(it)}-${String((it as any).timestamp)}-${String((it as any).subject)}`;

      return { it, key: reactKey, enter };
    });
  }, [items]);

  if (isLoading && (!items || items.length === 0)) {
    return (
      <div className="ab-board">
        <div className="ab-loading">Loading...</div>
      </div>
    );
  }

  if (!items || items.length === 0) return null;

  return (
    <div className="ab-board">
      <div className="ab-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="ab-pulse" />
          <span>Live Feed</span>
        </div>
      </div>

      <div className="ab-list">
        {rowsWithFlags.map(({ it: item, key, enter }) => {
          const type = String((item as any).type || "");
          const isBuy = type === "BUY";
          const isWin = type === "WIN";
          const isCancel = type === "CANCEL";
          const isCreate = !isBuy && !isWin && !isCancel;

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

          const timestamp = String((item as any).timestamp || "0");
          const fresh = isFresh(timestamp, NEW_WINDOW_SEC);

          const rowClass = [
            "ab-row",
            enter ? "ab-enter" : "",
            fresh ? `ab-fresh ab-fresh-${iconClass}` : "",
            (item as any).pending ? "ab-pending" : "",
          ]
            .filter(Boolean)
            .join(" ");

          const lotteryId = getLotteryId(item);
          const lotteryName = getLotteryName(item);

          const subject = String((item as any).subject || "");
          const value = String((item as any).value || "0"); // BUY: ticket count; others: pot u6

          const pendingLabel = String((item as any).pendingLabel || "PENDING");
          const pending = !!(item as any).pending;

          const detailHref = buildDetailHref(lotteryId);

          const potUi = !isBuy && !isCancel ? fmtUsdcFromU6(value) : null;

          return (
            <div key={key} className={rowClass}>
              <div className={`ab-icon ${iconClass}`}>{icon}</div>

              <div className="ab-content">
                <div className="ab-main-text">
                  {isCancel ? (
                    <>
                      <a href={detailHref} className="ab-link">
                        {lotteryName}
                      </a>{" "}
                      got <b style={{ color: "#991b1b" }}>canceled</b> (min tickets not reached)
                    </>
                  ) : (
                    <>
                      <a
                        href={`https://explorer.etherlink.com/address/${subject}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ab-user"
                      >
                        {shortAddr(subject)}
                      </a>

                      {isBuy && (
                        <>
                          {" "}
                          bought <b>{value} tix</b> in{" "}
                          <a href={detailHref} className="ab-link">
                            {lotteryName}
                          </a>
                        </>
                      )}

                      {isCreate && (
                        <>
                          {" "}
                          created{" "}
                          <a href={detailHref} className="ab-link">
                            {lotteryName}
                          </a>
                          {potUi ? (
                            <>
                              {" "}
                              with <b>{potUi} USDC</b> to win!
                            </>
                          ) : (
                            <>!</>
                          )}
                        </>
                      )}

                      {isWin && (
                        <>
                          {" "}
                          won{" "}
                          {potUi ? (
                            <>
                              <b style={{ color: "#166534" }}>{potUi} USDC</b>
                            </>
                          ) : (
                            <b style={{ color: "#166534" }}>the prize</b>
                          )}{" "}
                          on{" "}
                          <a href={detailHref} className="ab-link">
                            {lotteryName}
                          </a>
                          !
                        </>
                      )}
                    </>
                  )}
                </div>

                <div className="ab-meta">
                  <span className="ab-time">
                    {timeAgoFrom(nowSec, timestamp)}
                    {fresh && <span className="ab-new-pill">NEW</span>}
                    {pending && (
                      <span
                        className="ab-new-pill"
                        style={{ marginLeft: 6, background: "rgba(2,132,199,.12)", color: "#075985" }}
                      >
                        {pendingLabel}
                      </span>
                    )}
                  </span>
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