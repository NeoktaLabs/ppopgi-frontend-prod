import { useEffect, useState, useCallback } from "react";

function extractAddress(input: string): string | null {
  const m = (input || "").match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0].toLowerCase() : null;
}

export function useAppRouting() {
  const [selectedRaffleId, setSelectedRaffleId] = useState<string | null>(null);

  const getParam = useCallback(() => {
    const url = new URL(window.location.href);
    return extractAddress(url.searchParams.get("raffle") || "");
  }, []);

  // Sync URL -> State (back/forward)
  useEffect(() => {
    setSelectedRaffleId(getParam());

    const onPop = () => setSelectedRaffleId(getParam());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [getParam]);

  // Sync State -> URL
  const openRaffle = useCallback((id: string) => {
    const addr = (extractAddress(id) ?? id).toLowerCase();
    setSelectedRaffleId(addr);

    try {
      const url = new URL(window.location.href);
      url.searchParams.set("raffle", addr);
      window.history.pushState({}, "", url.toString());
    } catch {}
  }, []);

  const closeRaffle = useCallback(() => {
    setSelectedRaffleId(null);

    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("raffle"); // ✅ don't wipe other params
      window.history.pushState({}, "", url.toString());
    } catch {}
  }, []);

  return { selectedRaffleId, openRaffle, closeRaffle };
}