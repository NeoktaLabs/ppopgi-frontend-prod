// src/components/CreateRaffleModal.tsx
import React, { useState, useMemo } from "react";
import { formatUnits } from "ethers";
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

export function CreateRaffleModal({ open, onClose, onCreated }: Props) {
  const { fireConfetti } = useConfetti();
  
  // State for Success View
  const [step, setStep] = useState<"form" | "success">("form");
  const [createdAddr, setCreatedAddr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ✅ FIX: Intercept success, show view, DO NOT close yet.
  const handleSuccess = (addr?: string) => {
    fireConfetti(); // Boom!
    if (addr) {
      setCreatedAddr(addr);
      setStep("success"); // Switch to "Share" view
    }
    // We intentionally DO NOT call onCreated() here yet, 
    // because that might close the modal in the parent component.
  };

  // ✅ FIX: Handle the final "Close" action
  const handleFinalClose = () => {
    // 1. Notify parent to refresh data
    if (onCreated && createdAddr) onCreated(createdAddr);
    
    // 2. Close Modal
    onClose();

    // 3. Navigate/Refresh to Home
    // This ensures the user lands on the dashboard to see their new raffle
    if (window.location.pathname !== "/") {
      window.location.href = "/";
    } else {
       // If already on home, just close (parent refresh handled by onCreated)
       // Optional: window.location.reload(); if you want a hard refresh
    }
  };

  const { form, validation, derived, status, helpers } = useCreateRaffleForm(open, handleSuccess);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Generate Share Links
  const shareLink = createdAddr ? `${window.location.origin}/?raffle=${createdAddr}` : "";
  const tweetText = `I just created a new raffle on Ppopgi! 🎟️\n\nPrize: ${form.winningPot} USDC\nCheck it out here:`;
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(shareLink)}`;
  const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent(tweetText)}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const previewRaffle = useMemo(() => ({
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
  }), [form.name, derived, validation.durationSecondsN]);

  // Reset internal state if modal is re-opened
  React.useEffect(() => {
    if (open) {
      setStep("form");
      setCreatedAddr(null);
    }
  }, [open]);

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
          <button className="crm-close-btn" onClick={handleFinalClose}>✕</button>
        </div>

        {/* --- VIEW 1: SUCCESS (SHARE) --- */}
        {step === "success" ? (
          <div className="crm-success-view">
            <div className="crm-success-icon">✓</div>
            <div className="crm-success-title">Raffle Created!</div>
            <div className="crm-success-sub">
              Your contract is live. Share the link below to start selling tickets.
            </div>

            <div className="crm-share-box">
               <label className="crm-label" style={{textAlign:'left'}}>Direct Link</label>
               <div className="crm-link-row">
                  <input className="crm-link-input" readOnly value={shareLink} onClick={(e) => (e.target as HTMLInputElement).select()} />
                  <button className={`crm-copy-btn ${copied ? "copied" : ""}`} onClick={handleCopy}>
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
          /* --- VIEW 2: FORM --- */
          <div className="crm-body">
            {/* LEFT: Configuration */}
            <div className="crm-form-col">
              <div className="crm-bal-row">
                 <span className="crm-bal-label">My Balance</span>
                 <span className="crm-bal-val">
                   {status.usdcBal !== null ? formatUnits(status.usdcBal, 6) : "..."} USDC
                 </span>
              </div>

              <div className="crm-input-group">
                <label>Raffle Name</label>
                <input 
                  className="crm-input" 
                  value={form.name} 
                  onChange={e => form.setName(e.target.value)} 
                  placeholder="e.g. Bored Ape #8888" 
                  maxLength={32}
                />
              </div>

              <div className="crm-grid-2">
                <div className="crm-input-group">
                  <label>Ticket Price</label>
                  <div className="crm-input-wrapper">
                    <input inputMode="numeric" value={form.ticketPrice} onChange={e => form.setTicketPrice(helpers.sanitizeInt(e.target.value))} />
                    <span className="crm-suffix">USDC</span>
                  </div>
                </div>
                <div className="crm-input-group">
                  <label>Total Prize</label>
                  <div className="crm-input-wrapper">
                    <input inputMode="numeric" value={form.winningPot} onChange={e => form.setWinningPot(helpers.sanitizeInt(e.target.value))} />
                    <span className="crm-suffix">USDC</span>
                  </div>
                </div>
              </div>

              <div className="crm-grid-dur">
                 <div className="crm-input-group">
                   <label>Duration</label>
                   <input className="crm-input" inputMode="numeric" value={form.durationValue} onChange={e => form.setDurationValue(helpers.sanitizeInt(e.target.value))} />
                 </div>
                 <div className="crm-input-group">
                   <label>Unit</label>
                   <select className="crm-select" value={form.durationUnit} onChange={e => form.setDurationUnit(e.target.value as any)}>
                     <option value="minutes">Minutes</option>
                     <option value="hours">Hours</option>
                     <option value="days">Days</option>
                   </select>
                 </div>
              </div>

              <div className="crm-advanced">
                <button type="button" className="crm-adv-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}>
                  {advancedOpen ? "− Less Options" : "+ Advanced Options (Limits)"}
                </button>
                
                {advancedOpen && (
                  <div className="crm-adv-content">
                     <div className="crm-grid-2">
                       <div className="crm-input-group">
                         <label>Min Tickets to Draw</label>
                         <input className="crm-input" value={form.minTickets} onChange={e => form.setMinTickets(helpers.sanitizeInt(e.target.value))} />
                       </div>
                       <div className="crm-input-group">
                         <label>Max Capacity (Opt)</label>
                         <input className="crm-input" value={form.maxTickets} onChange={e => form.setMaxTickets(helpers.sanitizeInt(e.target.value))} placeholder="∞" />
                       </div>
                     </div>
                  </div>
                )}
              </div>

              <div className="crm-actions">
                <div className="crm-steps">
                  
                  {/* STEP 1: PREPARE WALLET */}
                  <button 
                    className={`crm-step-btn ${status.isReady ? "done" : "active"}`}
                    onClick={status.approve}
                    disabled={status.isReady}
                  >
                    <span className="crm-step-icon">{status.isReady ? "✓" : "1"}</span>
                    <span>{status.isReady ? "Wallet Prepared" : "Prepare Wallet"}</span>
                  </button>

                  <div className="crm-step-line" />

                  {/* STEP 2: CREATE RAFFLE */}
                  <button 
                    className={`crm-step-btn ${status.isReady ? "active primary" : ""}`}
                    onClick={status.create}
                    disabled={!validation.canSubmit || status.isPending}
                  >
                    <span className="crm-step-icon">{status.isPending ? "⏳" : "2"}</span>
                    <span>{status.isPending ? "Creating..." : "Create Raffle"}</span>
                  </button>
                </div>
                
                {status.msg && <div className="crm-status-msg">{status.msg}</div>}
              </div>
            </div>

            {/* RIGHT: Preview */}
            <div className="crm-preview-col">
              <div className="crm-preview-label">Live Preview</div>
              <div className="crm-card-wrapper">
                 {/* @ts-ignore */}
                 <RaffleCard raffle={previewRaffle} onOpen={()=>{}} />
              </div>
              <div className="crm-network-tip">
                 Network: Etherlink Mainnet
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
