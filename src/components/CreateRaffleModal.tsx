// src/components/CreateRaffleModal.tsx
import React, { useState, useMemo } from "react";
import { formatUnits } from "ethers";
import { useActiveAccount } from "thirdweb/react";
import { ADDRESSES } from "../config/contracts";
import { RaffleCard } from "./RaffleCard";
import { useCreateRaffleForm } from "../hooks/useCreateRaffleForm";
import { useConfetti } from "../hooks/useConfetti";
import "./CreateRaffleModal.css";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (raffleAddress?: string) => void;
};

function toBigInt6(v: string): bigint {
  const clean = String(v || "").replace(/[^\d]/g, "");
  if (!clean) return 0n;
  try {
    return BigInt(clean) * 1_000_000n;
  } catch {
    return 0n;
  }
}

function toInt(v: string): number {
  const clean = String(v || "").replace(/[^\d]/g, "");
  if (!clean) return 0;
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

type DurUnit = "minutes" | "hours" | "days";

const MIN_DURATION_SEC = 10 * 60; // 10 minutes
const MAX_DURATION_SEC = 365 * 24 * 60 * 60; // 365 days

function unitToSeconds(unit: DurUnit): number {
  if (unit === "minutes") return 60;
  if (unit === "hours") return 3600;
  return 86400;
}

function clampDurationToBounds(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_DURATION_SEC;
  if (seconds < MIN_DURATION_SEC) return MIN_DURATION_SEC;
  if (seconds > MAX_DURATION_SEC) return MAX_DURATION_SEC;
  return Math.floor(seconds);
}

function secondsToBestUnitValue(seconds: number, unit: DurUnit): { value: number; unit: DurUnit } {
  // Keep the chosen unit (don’t change design/UX unexpectedly), just clamp the value.
  const per = unitToSeconds(unit);
  const v = Math.max(1, Math.round(seconds / per));
  return { value: v, unit };
}

export function CreateRaffleModal({ open, onClose, onCreated }: Props) {
  // ✅ Hooks must be called unconditionally (even when open=false)
  const { fireConfetti } = useConfetti();
  const account = useActiveAccount();
  const isConnected = !!account?.address;

  const [step, setStep] = useState<"form" | "success">("form");
  const [createdAddr, setCreatedAddr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // enables red highlights
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const [advancedOpen, setAdvancedOpen] = useState(false);

  const handleSuccess = (addr?: string) => {
    fireConfetti();
    if (addr) {
      setCreatedAddr(addr);
      setStep("success");
    }
  };

  const handleFinalClose = () => {
    if (onCreated && createdAddr) onCreated(createdAddr);
    onClose();
    if (window.location.pathname !== "/") window.location.href = "/";
  };

  const { form, validation, derived, status, helpers } = useCreateRaffleForm(open, handleSuccess);

  // Reset internal state if modal is re-opened
  React.useEffect(() => {
    if (open) {
      setStep("form");
      setCreatedAddr(null);
      setCopied(false);
      setSubmitAttempted(false);
      setAdvancedOpen(false);
    }
  }, [open]);

  // ---------------------------------------------
  // ✅ Min/Max safeguard (UI auto-bump)
  // - maxTickets: "0" means unlimited => NEVER change it automatically
  // - if max > 0 and min > max => bump max up to min
  // - if max > 0 and max < min => lower min down to max
  // ---------------------------------------------
  const handleMinTicketsChange = (raw: string) => {
    const nextMinStr = helpers.sanitizeInt(raw);
    const nextMin = toInt(nextMinStr);

    const curMaxStr = form.maxTickets || "0";
    const curMax = toInt(curMaxStr);

    // If max is limited and next min exceeds it => bump max up to min
    if (curMax > 0 && nextMin > curMax) {
      form.setMaxTickets(String(nextMin));
    }

    form.setMinTickets(nextMinStr);
  };

  const handleMaxTicketsChange = (raw: string) => {
    const nextMaxStr = helpers.sanitizeInt(raw);
    const nextMax = toInt(nextMaxStr);

    // If user sets max back to 0 => unlimited, allow any min (no auto changes)
    if (nextMax === 0) {
      form.setMaxTickets(nextMaxStr);
      return;
    }

    const curMinStr = form.minTickets || "0";
    const curMin = toInt(curMinStr);

    // If max becomes smaller than min => lower min down to max
    if (curMin > 0 && nextMax < curMin) {
      form.setMinTickets(String(nextMax));
    }

    form.setMaxTickets(nextMaxStr);
  };

  // ---------------------------------------------
  // ✅ Duration enforcement (10 min .. 365 days)
  // - Clamp on blur (typing stays smooth)
  // - Clamp when unit changes (prevents out-of-range instantly)
  // ---------------------------------------------
  const durationSecondsN = validation.durationSecondsN;

  const durationTooShort = durationSecondsN > 0 && durationSecondsN < MIN_DURATION_SEC;
  const durationTooLong = durationSecondsN > 0 && durationSecondsN > MAX_DURATION_SEC;
  const durationOutOfBounds = durationTooShort || durationTooLong;

  const clampDurationFromCurrentInputs = (nextUnit?: DurUnit) => {
    const unit = (nextUnit ?? form.durationUnit) as DurUnit;
    const rawVal = toInt(form.durationValue || "0");
    const seconds = rawVal * unitToSeconds(unit);
    const clamped = clampDurationToBounds(seconds);
    const { value } = secondsToBestUnitValue(clamped, unit);

    // keep same unit, update value only
    form.setDurationValue(String(value));
    if (nextUnit) form.setDurationUnit(nextUnit);
  };

  const handleDurationBlur = () => {
    // If user left it empty/0, still clamp to minimum
    clampDurationFromCurrentInputs();
  };

  const handleDurationUnitChange = (u: DurUnit) => {
    // Switch unit, then clamp based on that new unit
    clampDurationFromCurrentInputs(u);
  };

  // ---------------------------------------------
  // Balance vs Winning Pot validation
  // ---------------------------------------------
  const winningPotU6 = useMemo(() => toBigInt6(form.winningPot), [form.winningPot]);
  const usdcBalU6 = status.usdcBal ?? null;

  const hasBalanceInfo = usdcBalU6 !== null;
  const insufficientPrizeFunds = hasBalanceInfo ? winningPotU6 > usdcBalU6! : false;

  // ---------------------------------------------
  // Required field validation (UI only)
  // ---------------------------------------------
  const invalidName = !form.name.trim();
  const invalidTicketPrice = Number(form.ticketPrice) <= 0;
  const invalidWinningPot = Number(form.winningPot) <= 0;

  // keep your base invalidDuration, but also include bounds
  const invalidDurationBase = Number(form.durationValue) <= 0;
  const invalidDuration = invalidDurationBase || durationOutOfBounds;

  const showInvalid = submitAttempted;

  const fieldClass = (invalid: boolean) => `crm-input ${showInvalid && invalid ? "crm-input-invalid" : ""}`;

  // ✅ Only allow create if connected + valid + enough balance + duration within bounds
  const canCreate =
    isConnected &&
    validation.canSubmit &&
    !status.isPending &&
    !insufficientPrizeFunds &&
    !durationOutOfBounds &&
    !invalidDurationBase;

  // ✅ button visuals when disabled
  const createDisabled = !canCreate;
  const createBtnStyle: React.CSSProperties = createDisabled
    ? { opacity: 0.45, cursor: "not-allowed", filter: "grayscale(0.35)" }
    : {};

  // Share links (success view)
  const shareLink = createdAddr ? `${window.location.origin}/?raffle=${createdAddr}` : "";
  const tweetText = `I just created a new raffle on Ppopgi! 🎟️\n\nPrize: ${form.winningPot} USDC\nCheck it out here:`;
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(shareLink)}`;
  const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent(tweetText)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  const previewRaffle = useMemo(
    () => ({
      id: "preview",
      name: form.name || "Your Raffle Name",
      status: "OPEN",
      winningPot: String(derived.winningPotU),
      ticketPrice: String(derived.ticketPriceU),
      deadline: String(Math.floor(Date.now() / 1000) + validation.durationSecondsN),
      sold: "0",
      maxTickets: String(derived.maxT),
      minTickets: String(derived.minT),
      protocolFeePercent: String(derived.configData?.protocolFeePercent ?? "0"),
      feeRecipient: String(derived.configData?.feeRecipient || ADDRESSES.SingleWinnerDeployer),
      deployer: ADDRESSES.SingleWinnerDeployer,
      creator: derived.me ?? "0x000",
      lastUpdatedTimestamp: String(Math.floor(Date.now() / 1000)),
    }),
    [form.name, derived, validation.durationSecondsN]
  );

  // ✅ AFTER all hooks
  if (!open) return null;

  return (
    <div className="crm-overlay" onMouseDown={handleFinalClose}>
      <div className="crm-modal" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="crm-header">
          <div className="crm-header-text">
            <h3>{step === "success" ? "You're Live! 🎉" : "Creator Studio"}</h3>
            <span>{step === "success" ? "Your raffle is now on the blockchain." : "Create your provably fair raffle."}</span>
          </div>
          <button className="crm-close-btn" onClick={handleFinalClose}>
            ✕
          </button>
        </div>

        {/* SUCCESS */}
        {step === "success" ? (
          <div className="crm-success-view">
            <div className="crm-success-icon">✓</div>
            <div className="crm-success-title">Raffle Created!</div>
            <div className="crm-success-sub">Your contract is live. Share the link below to start selling tickets.</div>

            <div className="crm-share-box">
              <label className="crm-label" style={{ textAlign: "left" }}>
                Direct Link
              </label>
              <div className="crm-link-row">
                <input
                  className="crm-link-input"
                  readOnly
                  value={shareLink}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  className={`crm-copy-btn ${copied ? "copied" : ""}`}
                  onClick={handleCopy}
                  disabled={!shareLink}
                  title={!shareLink ? "No link yet" : "Copy link"}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            <div className="crm-social-row">
              <a href={tweetUrl} target="_blank" rel="noreferrer" className="crm-social-btn twitter">
                Share on 𝕏
              </a>
              <a href={tgUrl} target="_blank" rel="noreferrer" className="crm-social-btn telegram">
                Telegram
              </a>
            </div>

            <button className="crm-done-btn" onClick={handleFinalClose}>
              Skip and view dashboard →
            </button>
          </div>
        ) : (
          /* FORM */
          <div className="crm-body">
            {/* LEFT */}
            <div className="crm-form-col">
              <div className="crm-bal-row">
                <span className="crm-bal-label">My Balance</span>
                <span className="crm-bal-val">{status.usdcBal !== null ? formatUnits(status.usdcBal, 6) : "..."} USDC</span>
              </div>

              <div className="crm-input-group">
                <label>Raffle Name</label>
                <input
                  className={fieldClass(invalidName)}
                  value={form.name}
                  onChange={(e) => form.setName(e.target.value)}
                  placeholder="e.g. Bored Ape #8888"
                  maxLength={32}
                />
              </div>

              <div className="crm-grid-2">
                <div className="crm-input-group">
                  <label>Ticket Price</label>
                  <div className="crm-input-wrapper">
                    <input
                      className={fieldClass(invalidTicketPrice)}
                      inputMode="numeric"
                      value={form.ticketPrice}
                      onChange={(e) => form.setTicketPrice(helpers.sanitizeInt(e.target.value))}
                    />
                    <span className="crm-suffix">USDC</span>
                  </div>
                </div>

                <div className="crm-input-group">
                  <label>Total Prize</label>
                  <div className="crm-input-wrapper">
                    <input
                      className={fieldClass(invalidWinningPot)}
                      inputMode="numeric"
                      value={form.winningPot}
                      onChange={(e) => form.setWinningPot(helpers.sanitizeInt(e.target.value))}
                    />
                    <span className="crm-suffix">USDC</span>
                  </div>
                </div>
              </div>

              {/* ✅ Not enough balance + spacing */}
              {hasBalanceInfo && insufficientPrizeFunds && (
                <div
                  className="crm-status-msg"
                  style={{
                    marginTop: 10,
                    marginBottom: 14,
                    background: "#fff7ed",
                    border: "1px solid #fed7aa",
                    color: "#9a3412",
                    fontWeight: 800,
                  }}
                >
                  Your wallet balance isn’t enough to fund this prize.
                </div>
              )}

              <div className="crm-grid-dur">
                <div className="crm-input-group">
                  <label>Duration</label>
                  <input
                    className={fieldClass(invalidDuration)}
                    inputMode="numeric"
                    value={form.durationValue}
                    onChange={(e) => form.setDurationValue(helpers.sanitizeInt(e.target.value))}
                    onBlur={handleDurationBlur}
                  />
                </div>

                <div className="crm-input-group">
                  <label>Unit</label>
                  <select
                    className="crm-select"
                    value={form.durationUnit}
                    onChange={(e) => handleDurationUnitChange(e.target.value as DurUnit)}
                  >
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </div>

              {/* ✅ Duration bounds helper (matches contract rules) */}
              {durationOutOfBounds && (
                <div
                  className="crm-status-msg"
                  style={{
                    marginTop: 10,
                    marginBottom: 14,
                    background: "#fff7ed",
                    border: "1px solid #fed7aa",
                    color: "#9a3412",
                    fontWeight: 800,
                  }}
                >
                  Duration must be between <b>10 minutes</b> and <b>365 days</b>.
                </div>
              )}

              {/* Advanced */}
              <div className="crm-advanced">
                <button type="button" className="crm-adv-toggle" onClick={() => setAdvancedOpen((v) => !v)}>
                  {advancedOpen ? "− Less Options" : "+ Advanced Options (Limits)"}
                </button>

                {advancedOpen && (
                  <div className="crm-adv-content">
                    <div className="crm-grid-2">
                      <div className="crm-input-group">
                        <label>Min Tickets to Draw</label>
                        <input className="crm-input" value={form.minTickets} onChange={(e) => handleMinTicketsChange(e.target.value)} />
                      </div>
                      <div className="crm-input-group">
                        <label>Max Capacity (Opt)</label>
                        <input
                          className="crm-input"
                          value={form.maxTickets}
                          onChange={(e) => handleMaxTicketsChange(e.target.value)}
                          placeholder="∞"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="crm-actions">
                <div className="crm-steps">
                  {/* STEP 1 */}
                  <button
                    className={`crm-step-btn ${status.isReady ? "done" : "active"}`}
                    onClick={status.approve}
                    disabled={!isConnected || status.isReady}
                  >
                    <span className="crm-step-icon">{status.isReady ? "✓" : "1"}</span>
                    <span>{status.isReady ? "Wallet Prepared" : "Prepare Wallet"}</span>
                  </button>

                  <div className="crm-step-line" />

                  {/* STEP 2 */}
                  <button
                    className={`crm-step-btn ${status.isReady ? "active primary" : ""}`}
                    onClick={() => {
                      setSubmitAttempted(true);
                      if (canCreate) status.create();
                    }}
                    disabled={createDisabled}
                    style={createBtnStyle}
                  >
                    <span className="crm-step-icon">{status.isPending ? "⏳" : "2"}</span>
                    <span>{status.isPending ? "Creating..." : "Create Raffle"}</span>
                  </button>
                </div>

                {status.msg && <div className="crm-status-msg">{status.msg}</div>}
              </div>
            </div>

            {/* RIGHT */}
            <div className="crm-preview-col">
              <div className="crm-preview-label">Live Preview</div>
              <div className="crm-card-wrapper">
                {/* @ts-ignore */}
                <RaffleCard raffle={previewRaffle} onOpen={() => {}} />
              </div>
              <div className="crm-network-tip">Network: Etherlink Mainnet</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}