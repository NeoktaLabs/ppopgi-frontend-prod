// src/hooks/useSafetyBreakdown.ts
import { useMemo } from "react";
import { formatUnits } from "ethers";
import type { LotteryDetails } from "./useLotteryDetails"; // ✅ updated type name

// --- Helpers ---
const safeBigInt = (x: any) => {
  try {
    return BigInt(x || "0");
  } catch {
    return 0n;
  }
};

const fmt = (n: bigint) => {
  try {
    return formatUnits(n, 6);
  } catch {
    return "0";
  }
};

export function useSafetyBreakdown(lottery: LotteryDetails) {
  return useMemo(() => {
    const revenue = safeBigInt(lottery.ticketRevenue);
    const pot = safeBigInt(lottery.winningPot);
    const pct = safeBigInt(lottery.protocolFeePercent);

    // fee = revenue * pct / 100
    const fee = (revenue * pct) / 100n;

    // creator share = revenue - pot - fee (floored at 0)
    let creatorSoFar = revenue - pot - fee;
    if (creatorSoFar < 0n) creatorSoFar = 0n;

    return {
      revenue: fmt(revenue),
      pot: fmt(pot),
      pct: pct.toString(),
      fee: fmt(fee),
      creatorSoFar: fmt(creatorSoFar),
    };
  }, [lottery]);
}