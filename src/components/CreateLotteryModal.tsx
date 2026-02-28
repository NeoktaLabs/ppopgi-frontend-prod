// src/components/CreateLotteryModal.tsx
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { formatUnits } from "ethers";
import { useActiveAccount } from "thirdweb/react";
import { ADDRESSES } from "../config/contracts";
import { LotteryCard } from "./LotteryCard";
import { useCreateLotteryForm } from "../hooks/useCreateLotteryForm";
import { useConfetti } from "../hooks/useConfetti";
import "./CreateLotteryModal.css";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (lotteryAddress?: string) => void; // keep prop name to avoid touching callers
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
  const per = unitToSeconds(unit);
  const v = Math.max(1, Math.round(seconds / per));
  return { value: v, unit };
}

/** ✅ UPDATED: Custom CSS Tooltip matching InfraStatusPill */
function HelpTip({ text }: { text: string }) {
  return (
    <span className="crm-q" tabIndex={0} aria-label={text}>
      ?
      <span className="crm-tip" role="tooltip">
        {text}
      </span>
    </span>
  );
}

export function CreateLotteryModal({ open, onClose, onCreated }: Props) {
  const { fireConfetti } = useConfetti();
  const account = useActiveAccount();
  const isConnected = !!account?.address;

  const [step, setStep] = useState<"form" | "success">("form");
  const [createdAddr, setCreatedAddr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const successTimerRef = useRef<number | null>(null);

  const clearSuccessTimer = () => {
    if (successTimerRef.current != null) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  };

  const goHome = useCallback(() => {
    if (window.location.pathname !== "/") window.location.href = "/";
    else window.location.reload();
  }, []);

  const handleFinalClose = useCallback(() => {
    clearSuccessTimer();
    if (onCreated && createdAddr) onCreated(createdAddr);
    onClose();
    goHome();
  }, [onClose, onCreated, createdAddr, goHome]);

  const handleSuccess = useCallback(
    (addr?: string) => {
      fireConfetti();
      if (addr) {
        setCreatedAddr(addr);
        setStep("success");
      }
    },
    [fireConfetti]
  );

  // ✅ hook
  const { form, validation, derived, status, helpers } = useCreateLotteryForm(open, handleSuccess);

  useEffect(() => {
    if (open) {
      setStep("form");
      setCreatedAddr(null);
      setCopied(false);
      setSubmitAttempted(false);
      setAdvancedOpen(false);
      clearSuccessTimer();
    }
  }, [open]);

  useEffect(() => {
    clearSuccessTimer();
    if (!open) return;
    if (step !== "success") return;

    successTimerRef.current = window.setTimeout(() => {
      handleFinalClose();
    }, 3_000);

    return () => {
      clearSuccessTimer();
    };
  }, [open, step, handleFinalClose]);

  // ✅ Force Min Purchase to 1 (removes UI + enforces invariant)
  useEffect(() => {
    if (!open) return;
    // if hook supports it, keep it pinned to "1"
    try {
      if (typeof (form as any).setMinPurchaseAmount === "function") {
        const cur = String((form as any).minPurchaseAmount ?? "");
        if (cur !== "1") (form as any).setMinPurchaseAmount("1");
      }
    } catch {
      // no-op
    }
    // Intentionally only depends on open + current value (if present)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, (form as any).minPurchaseAmount]);

  const handleMinTicketsChange = (raw: string) => {
    const nextMinStr = helpers.sanitizeInt(raw);
    const nextMin = toInt(nextMinStr);
    const curMaxStr = form.maxTickets || "0";
    const curMax = toInt(curMaxStr);
    if (curMax > 0 && nextMin > curMax) {
      form.setMaxTickets(String(nextMin));
    }
    form.setMinTickets(nextMinStr);
  };

  const handleMaxTicketsChange = (raw: string) => {
    const nextMaxStr = helpers.sanitizeInt(raw);
    const nextMax = toInt(nextMaxStr);
    if (nextMax === 0) {
      form.setMaxTickets(nextMaxStr);
      return;
    }
    const curMinStr = form.minTickets || "0";
    const curMin = toInt(curMinStr);
    if (curMin > 0 && nextMax < curMin) {
      form.setMinTickets(String(nextMax));
    }
    form.setMaxTickets(nextMaxStr);
  };

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
    form.setDurationValue(String(value));
    if (nextUnit) form.setDurationUnit(nextUnit);
  };

  const handleDurationBlur = () => clampDurationFromCurrentInputs();
  const handleDurationUnitChange = (u: DurUnit) => clampDurationFromCurrentInputs(u);

  const winningPotU6 = useMemo(() => toBigInt6(form.winningPot), [form.winningPot]);
  const usdcBalU6 = status.usdcBal ?? null;
  const hasBalanceInfo = usdcBalU6 !== null;
  const insufficientPrizeFunds = hasBalanceInfo ? winningPotU6 > usdcBalU6! : false;

  const invalidName = !form.name.trim();
  const invalidTicketPrice = Number(form.ticketPrice) <= 0;
  const invalidWinningPot = Number(form.winningPot) <= 0;
  const invalidDurationBase = Number(form.durationValue) <= 0;
  const invalidDuration = invalidDurationBase || durationOutOfBounds;
  const showInvalid = submitAttempted;

  const fieldClass = (invalid: boolean) => `crm-input ${showInvalid && invalid ? "crm-input-invalid" : ""}`;

  // ✅ "wallet ready" is simply: allowance >= winningPot
  const isReady = validation.hasEnoughAllowance;

  const canCreate =
    isConnected &&
    validation.canSubmit &&
    !status.isPending &&
    !insufficientPrizeFunds &&
    !durationOutOfBounds &&
    !invalidDurationBase;

  const createDisabled = !canCreate;

  // Keep your router param as-is for now
  const shareLink = createdAddr ? `${window.location.origin}/?lottery=${createdAddr}` : "";
  const tweetText = `I just created a new lottery on Ppopgi (뽑기)! 🎟️\n\nPrize: ${form.winningPot} USDC\nCheck it out here:`;
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(shareLink)}`;
  const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent(tweetText)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  // ✅ protocol fee (attempt to read from the hook; fallback safely)
  const protocolFeePercent = useMemo(() => {
    // Common places a hook might expose it:
    const candidates = [
      (derived as any)?.protocolFeePercent,
      (validation as any)?.protocolFeePercent,
      (status as any)?.protocolFeePercent,
      (derived as any)?.feePercent,
      (validation as any)?.feePercent,
      (status as any)?.feePercent,
    ]
      .map((v) => (v == null ? null : String(v)))
      .filter(Boolean) as string[];

    const raw = candidates[0] ?? "0";
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(20, Math.max(0, n));
  }, [derived, validation, status]);

  // ✅ preview object must match what LotteryCard expects (LotteryListItem-ish)
  const previewLottery = useMemo(
    () => ({
      id: "0xpreview",
      name: form.name || "Your Lottery Name",
      status: "OPEN",
      winningPot: String(derived.winningPotU),
      ticketPrice: String(derived.ticketPriceU),
      deadline: String(Math.floor(Date.now() / 1000) + validation.durationSecondsN),
      sold: "0",
      maxTickets: String(derived.maxT),
      minTickets: String(derived.minT),
      protocolFeePercent: String(protocolFeePercent),
      feeRecipient: ADDRESSES.SingleWinnerDeployer,
      creator: derived.me ?? "0x0000000000000000000000000000000000000000",
      registeredAt: String(Math.floor(Date.now() / 1000)),
      usdcToken: ADDRESSES.USDC.toLowerCase(),
    }),
    [form.name, derived, validation.durationSecondsN, protocolFeePercent]
  );

  if (!open) return null;

  return (
    <div
      className="crm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleFinalClose();
      }}
    >
      <div className="crm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="crm-header">
          <div className="crm-header-text">
            <h3>{step === "success" ? "You're Live! 🎉" : "Creator Studio"}</h3>
            <span>{step === "success" ? "Your lottery is now on the blockchain." : "Create your provably fair lottery."}</span>
          </div>
          <button className="crm-close-btn" onClick={handleFinalClose}>
            ✕
          </button>
        </div>

        {/* SUCCESS VIEW */}
        {step === "success" ? (
          <div className="crm-success-view">
            <div className="crm-success-icon">✓</div>
            <div className="crm-success-title">Lottery Created!</div>
            <div className="crm-success-sub">
              Your contract is live. Share the link below to start selling tickets.
              <br />
              <span style={{ display: "inline-block", marginTop: 6, opacity: 0.75, fontWeight: 800 }}>
                Redirecting to home in ~3s…
              </span>
            </div>

            <div className="crm-share-ticket">
              <div className="crm-share-stub-left">
                <label className="crm-label-ticket">Direct Link</label>
                <div className="crm-ticket-code">{shareLink}</div>
              </div>
              <div className="crm-share-stub-right">
                <button
                  className={`crm-stamp-btn ${copied ? "stamped" : ""}`}
                  onClick={handleCopy}
                  disabled={!shareLink}
                  title="Copy Link"
                >
                  {copied ? "COPIED" : "COPY"}
                </button>
              </div>
            </div>

            <button type="button" className="crm-done-btn" onClick={handleFinalClose}>
              Close & go to Home →
            </button>

            <div className="crm-social-row">
              <a href={tweetUrl} target="_blank" rel="noreferrer" className="crm-social-btn twitter">
                Share on 𝕏
              </a>
              <a href={tgUrl} target="_blank" rel="noreferrer" className="crm-social-btn telegram">
                Telegram
              </a>
            </div>
          </div>
        ) : (
          /* FORM VIEW */
          <div className="crm-body">
            {/* LEFT: Form */}
            <div className="crm-form-col">
              <div className="crm-bal-row">
                <span className="crm-bal-label">My Balance</span>
                <span className="crm-bal-val">{status.usdcBal !== null ? formatUnits(status.usdcBal, 6) : "..."} USDC</span>
              </div>

              {/* ✅ Fee callout (enforced on-chain) */}
              <div
                style={{
                  marginTop: 10,
                  marginBottom: 14,
                  padding: "12px 12px",
                  borderRadius: 12,
                  background: "rgba(255, 238, 246, 0.70)",
                  border: "1px solid rgba(190, 24, 93, 0.18)",
                  color: "rgba(131, 24, 67, 0.95)",
                  fontWeight: 800,
                  fontSize: 12,
                  lineHeight: 1.35,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 1000, fontSize: 11 }}>
                    Protocol fee (enforced on-chain)
                  </span>
                  <span style={{ fontWeight: 1000 }}>{protocolFeePercent}%</span>
                </div>
                <div style={{ marginTop: 6, opacity: 0.9 }}>
                  This fee is applied to both the <b>prize payout</b> and the <b>ticket revenue</b> when the lottery completes.<br /> No fee is applied if the lottery is canceled.
                </div>
              </div>

              <div className="crm-input-group">
                <label>
                  Lottery Name
                  <HelpTip text="Displayed on the lottery card. This does not affect fairness — it’s just for humans." />
                </label>
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
                  <label>
                    Ticket Price
                    <HelpTip text="Cost per ticket in USDC. Players pay this amount per ticket they buy." />
                  </label>
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
                  <label>
                    Total Prize
                    <HelpTip text="How much USDC you deposit as the prize pot. This amount is locked in the lottery contract." />
                  </label>
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

              {hasBalanceInfo && insufficientPrizeFunds && (
                <div className="crm-warning-msg">⚠️ Your wallet balance isn’t enough to fund this prize.</div>
              )}

              <div className="crm-grid-dur">
                <div className="crm-input-group">
                  <label>
                    Duration (Min: 10m / Max: 365d)
                    <HelpTip text="How long ticket sales stay open. After this time (or sold-out), the lottery can settle." />
                  </label>
                  <input
                    className={fieldClass(invalidDuration)}
                    inputMode="numeric"
                    value={form.durationValue}
                    onChange={(e) => form.setDurationValue(helpers.sanitizeInt(e.target.value))}
                    onBlur={handleDurationBlur}
                  />
                </div>

                <div className="crm-input-group">
                  <label>
                    Unit
                    <HelpTip text="Pick minutes/hours/days. We clamp duration between 10 minutes and 365 days." />
                  </label>
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

              {durationOutOfBounds && (
                <div className="crm-warning-msg">
                  Duration must be between <b>10m</b> and <b>365d</b>.
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
                        <label>
                          Min Tickets
                          <HelpTip text="Minimum tickets required to draw a winner. If not reached by the deadline, it will cancel." />
                        </label>
                        <input
                          className="crm-input"
                          value={form.minTickets}
                          onChange={(e) => handleMinTicketsChange(e.target.value)}
                          onBlur={() => {
                            if (!form.minTickets || toInt(form.minTickets) <= 0) form.setMinTickets("1");
                          }}
                        />
                      </div>

                      <div className="crm-input-group">
                        <label>
                          Max Tickets
                          <HelpTip text="Optional cap on total tickets. Leave empty (or 0) for unlimited capacity. The draw will happen as soon as max tickets is reached" />
                        </label>
                        <input
                          className="crm-input"
                          value={form.maxTickets}
                          onChange={(e) => handleMaxTicketsChange(e.target.value)}
                          placeholder="∞"
                        />
                      </div>
                    </div>

                    {/* ✅ Min Purchase removed. Enforced as 1 in code. */}
                    <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, color: "rgba(100, 116, 139, 1)" }}>
                      Min purchase is fixed to <b>1</b> ticket.
                    </div>
                  </div>
                )}
              </div>

              {/* COMMAND CENTER */}
              <div className="crm-command-center">
                <div className="crm-dock-glass">
                  <button
                    className={`crm-dock-btn ${isReady ? "done" : "active"}`}
                    onClick={status.approve}
                    disabled={!isConnected || isReady || status.isPending}
                    title="Approves USDC for the prize deposit"
                  >
                    <span className="crm-dock-icon">{isReady ? "Step 1 ✓" : "Step 1"}</span>
                    <span className="crm-dock-label">{isReady ? "Wallet Ready" : "Get Wallet Ready"}</span>
                  </button>

                  <div className="crm-dock-sep" />

                  <button
                    className={`crm-dock-btn primary ${!isReady || status.isPending ? "disabled" : "active"}`}
                    onClick={() => {
                      setSubmitAttempted(true);
                      if (canCreate) void status.create();
                    }}
                    disabled={createDisabled}
                    title="Deploys your lottery contract with these parameters"
                  >
                    <span className="crm-dock-icon">{status.isPending ? "⏳" : "Step 2"}</span>
                    <span className="crm-dock-label">{status.isPending ? "Creating..." : "Create your Lottery"}</span>
                  </button>
                </div>

                {status.msg && <div className="crm-status-msg">{status.msg}</div>}
              </div>
            </div>

            {/* RIGHT: Preview */}
            <div className="crm-preview-col">
              <div className="crm-preview-label">Live Preview</div>
              <div className="crm-levitate-wrapper">
                {/* @ts-ignore */}
                <LotteryCard lottery={previewLottery} onOpen={() => {}} />
              </div>
              <div className="crm-preview-shadow" />
              <div className="crm-network-tip">Network: Etherlink Mainnet</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
