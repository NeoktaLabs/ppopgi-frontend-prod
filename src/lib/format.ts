// src/lib/format.ts

/**
 * UI formatter for USDC / numbers
 *
 * Defaults:
 * - hides trailing ".0"
 * - no decimals unless specified
 * - keeps grouping (1,000)
 */
export function fmtUsdcUi(
  value: string | number,
  opts?: { maxDecimals?: number; minDecimals?: number }
) {
  const maxDecimals = opts?.maxDecimals ?? 0;
  const minDecimals = opts?.minDecimals ?? 0;

  const n = typeof value === "number" ? value : Number(value);
  const safe = Number.isFinite(n) ? n : 0;

  return safe.toLocaleString("en-US", {
    maximumFractionDigits: maxDecimals,
    minimumFractionDigits: minDecimals,
  });
}