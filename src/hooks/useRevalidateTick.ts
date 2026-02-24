import { useEffect, useRef, useState } from "react";

/**
 * Global revalidation hook.
 *
 * Listens for a window event (default: "ppopgi:revalidate")
 * and returns a numeric tick that increments whenever the event fires.
 *
 * Usage:
 * const rvTick = useRevalidate();
 *
 * useEffect(() => {
 *   if (rvTick === 0) return; // ignore initial render
 *   refetch();
 * }, [rvTick]);
 */

type Options = {
  eventName?: string;
  debounceMs?: number;
};

export function useRevalidate(options?: Options): number {
  const eventName = options?.eventName ?? "ppopgi:revalidate";
  const debounceMs = options?.debounceMs ?? 0;

  const [tick, setTick] = useState<number>(0);
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handler = () => {
      // Debounce if requested
      if (debounceMs > 0) {
        if (debounceTimerRef.current !== null) {
          window.clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = window.setTimeout(() => {
          setTick((t) => t + 1);
        }, debounceMs);

        return;
      }

      // Immediate mode
      setTick((t) => t + 1);
    };

    window.addEventListener(eventName as any, handler);

    return () => {
      window.removeEventListener(eventName as any, handler);

      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [eventName, debounceMs]);

  return tick;
}