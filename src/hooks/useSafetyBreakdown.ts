// src/hooks/useSafetyBreakdown.ts
import { useMemo } from "react";
import { formatUnits } from "ethers";
import type { RaffleDetails } from "./useRaffleDetails"; // Or wherever your type is

// Helper
const safeBigInt = (x: any) => { try { return BigInt(x || "0"); } catch { return 0n; } };
const fmt = (n: bigint) => { try { return formatUnits(n, 6); } catch { return "0"; } };

export function useSafetyBreakdown(raffle: RaffleDetails) {
  return useMemo(() => {
    const revenue = safeBigInt(raffle.ticketRevenue);
    const pot = safeBigInt(raffle.winningPot);
    const pct = safeBigInt(raffle.protocolFeePercent);

    // Math: fee = revenue * pct / 100
    const fee = (revenue * pct) / 100n;

    // Math: creator share = revenue - pot - fee (floored at 0)
    let creatorSoFar = revenue - pot - fee;
    if (creatorSoFar < 0n) creatorSoFar = 0n;

    return {
      revenue: fmt(revenue),
      pot: fmt(pot),
      pct: pct.toString(),
      fee: fmt(fee),
      creatorSoFar: fmt(creatorSoFar)
    };
  }, [raffle]);
}
