import { useEffect, useRef } from "react";
import { refresh as refreshLotteryStore } from "../hooks/useLotteryStore";
import { refresh as refreshActivityStore } from "../hooks/useActivityStore";

function isVisible() {
  try {
    return document.visibilityState === "visible";
  } catch {
    return true;
  }
}

export function GlobalDataRefresher({ intervalMs = 5000 }: { intervalMs?: number }) {
  const runningRef = useRef(false);
  const lastLotteryRefreshAtRef = useRef(0);

  const tick = async (background = false) => {
    if (runningRef.current) return;
    if (background && !isVisible()) return;

    runningRef.current = true;

    try {
      const now = Date.now();
      const RAFFLE_REFRESH_MIN_GAP_MS = 20_000;

      const shouldRefreshLotteries = !background || now - lastLotteryRefreshAtRef.current >= RAFFLE_REFRESH_MIN_GAP_MS;

      if (shouldRefreshLotteries) lastLotteryRefreshAtRef.current = now;

      // ✅ Run in parallel; don't let Activity block everything else.
      const tasks: Promise<any>[] = [];

      // Activity: light + frequent
      tasks.push(refreshActivityStore(true, true));

      // Lotteries: heavier + throttled
      if (shouldRefreshLotteries) {
        tasks.push(refreshLotteryStore(true, true));
      }

      // Never throw from refresher (stores already handle their own errors/backoff)
      await Promise.allSettled(tasks);

      // Notify listeners to recompute derived UI state
      try {
        window.dispatchEvent(new CustomEvent("ppopgi:revalidate"));
      } catch {}
    } finally {
      runningRef.current = false;
    }
  };

  useEffect(() => {
    void tick(false);

    const id = window.setInterval(() => void tick(true), intervalMs);

    const onFocus = () => void tick(false);
    const onVis = () => {
      try {
        if (document.visibilityState === "visible") void tick(false);
      } catch {}
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs]);

  return null;
}

export default GlobalDataRefresher;