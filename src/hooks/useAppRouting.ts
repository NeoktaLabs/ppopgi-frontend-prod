// src/hooks/useAppRouting.ts
import { useEffect, useState, useCallback } from "react";

function extractAddress(input: string): string | null {
  const m = (input || "").match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0].toLowerCase() : null;
}

export function useAppRouting() {
  const [selectedLotteryId, setSelectedLotteryId] = useState<string | null>(null);

  const getParam = useCallback(() => {
    const url = new URL(window.location.href);
    // ✅ new param: lottery
    const lottery = extractAddress(url.searchParams.get("lottery") || "");
    if (lottery) return lottery;
    // ✅ legacy param fallback: raffle
    return extractAddress(url.searchParams.get("raffle") || "");
  }, []);

  useEffect(() => {
    setSelectedLotteryId(getParam());

    const onPop = () => setSelectedLotteryId(getParam());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [getParam]);

  const openLottery = useCallback((id: string) => {
    const addr = (extractAddress(id) ?? id).toLowerCase();
    setSelectedLotteryId(addr);

    try {
      const url = new URL(window.location.href);
      url.searchParams.set("lottery", addr);
      url.searchParams.delete("raffle"); // ✅ clean legacy param
      window.history.pushState({}, "", url.toString());
    } catch {}
  }, []);

  const closeLottery = useCallback(() => {
    setSelectedLotteryId(null);

    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("lottery");
      url.searchParams.delete("raffle");
      window.history.pushState({}, "", url.toString());
    } catch {}
  }, []);

  return { selectedLotteryId, openLottery, closeLottery };
}