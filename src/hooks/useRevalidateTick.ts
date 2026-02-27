import { useEffect, useRef, useState } from "react";

type Options = {
  eventName?: string;
  debounceMs?: number;
};

export function useRevalidate(options?: Options): number {
  const eventName = options?.eventName ?? "ppopgi:revalidate";
  const debounceMs = options?.debounceMs ?? 0;

  const [tick, setTick] = useState(0);
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const bump = () => setTick((t) => t + 1);

    const handler = () => {
      if (debounceMs > 0) {
        if (debounceTimerRef.current != null) window.clearTimeout(debounceTimerRef.current);

        debounceTimerRef.current = window.setTimeout(() => {
          debounceTimerRef.current = null;
          bump();
        }, debounceMs);

        return;
      }

      bump();
    };

    window.addEventListener(eventName as any, handler);

    return () => {
      window.removeEventListener(eventName as any, handler);
      if (debounceTimerRef.current != null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [eventName, debounceMs]);

  return tick;
}