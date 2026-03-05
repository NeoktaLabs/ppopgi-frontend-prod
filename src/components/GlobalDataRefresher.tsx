import { useEffect, useRef } from "react";
import { refresh as refreshActivityStore } from "../hooks/useActivityStore";

function isVisible() {
  try {
    return document.visibilityState === "visible";
  } catch {
    return true;
  }
}

export function GlobalDataRefresher({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const runningRef = useRef(false);
  const lastActivityRefreshAtRef = useRef(0);

  const tick = async (background = false) => {
    if (runningRef.current) return;
    if (background && !isVisible()) return;

    runningRef.current = true;
    try {
      const now = Date.now();

      // Activity is cheap, but don’t spam
      const ACTIVITY_MIN_GAP_MS = 15_000;

      const shouldRefreshActivity = !background || now - lastActivityRefreshAtRef.current >= ACTIVITY_MIN_GAP_MS;
      if (!shouldRefreshActivity) return;

      lastActivityRefreshAtRef.current = now;

      // IMPORTANT: do NOT force-fresh on polling.
      await refreshActivityStore(true, false);
    } finally {
      runningRef.current = false;
    }
  };

  useEffect(() => {
    // Initial warm-up
    void tick(false);

    const id = window.setInterval(() => void tick(true), intervalMs);

    const onFocus = () => void tick(true);
    const onVis = () => {
      try {
        if (document.visibilityState === "visible") void tick(true);
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