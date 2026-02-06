// src/components/CashierModal.tsx
import { useState } from "react";
import { useCashierData } from "../hooks/useCashierData";
import "./CashierModal.css";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function CashierModal({ open, onClose }: Props) {
  const { state, actions, display } = useCashierData(open);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (state.me) {
      navigator.clipboard.writeText(state.me);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!open) return null;

  return (
    <div className="cm-overlay" onMouseDown={onClose}>
      <div className="cm-card" onMouseDown={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div className="cm-header">
          <h3 className="cm-title">My Wallet</h3>
          <button className="cm-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="cm-body">
          
          {/* Address Pill (Click to Copy) */}
          <div className="cm-address-row">
             <div className="cm-avatar-circle" style={{ background: copied ? "#dcfce7" : "#f1f5f9", color: copied ? "#166534" : "#64748b" }}>
               {copied ? "✓" : "👤"}
             </div>
             <div className="cm-address-info">
                <div className="cm-label">Connected Account</div>
                <div className="cm-addr-val" onClick={handleCopy} title="Click to Copy">
                   {display.shortAddr}
                   <span className="cm-copy-icon">{copied ? "Copied" : "Copy"}</span>
                </div>
             </div>
             <button className="cm-refresh-btn" onClick={actions.refresh} disabled={state.loading}>
               {state.loading ? "..." : "🔄"}
             </button>
          </div>

          {state.note && (
             <div className="cm-alert">
               ⚠️ {state.note}
             </div>
          )}

          {/* Balance Cards */}
          <div className="cm-balance-section">
             <div className="cm-section-label">Assets on Etherlink</div>
             
             <div className="cm-balance-grid">
                {/* USDC Card (Primary) */}
                <div className="cm-asset-card primary">
                   <div className="cm-asset-icon">💲</div>
                   <div>
                      <div className="cm-asset-amount">{display.usdc}</div>
                      <div className="cm-asset-name">USDC</div>
                   </div>
                   <div className="cm-asset-tag">Raffle Funds</div>
                </div>

                {/* XTZ Card (Secondary) */}
                <div className="cm-asset-card secondary">
                   <div className="cm-asset-icon">⛽</div>
                   <div>
                      <div className="cm-asset-amount">{display.xtz}</div>
                      <div className="cm-asset-name">Tezos (XTZ)</div>
                   </div>
                   <div className="cm-asset-tag">Network Fees</div>
                </div>
             </div>
          </div>

          {/* "Need Funds" Section */}
          <div className="cm-guide-section">
             <div className="cm-section-label">Need Funds?</div>
             
             {/* 1. Transak (Credit Card) - ✅ NEW */}
             <div className="cm-guide-row">
                <div className="cm-guide-icon">💳</div>
                <div className="cm-guide-text">
                   <strong>Buy with Card</strong>
                   <span>Purchase XTZ via Transak. <b>Select "Etherlink" network.</b></span>
                </div>
                <a 
                  href="https://transak.com/buy" 
                  target="_blank" 
                  rel="noreferrer"
                  className="cm-guide-btn"
                >
                  Go
                </a>
             </div>

             {/* 2. Swap - ✅ Updated Link */}
             <div className="cm-guide-row">
                <div className="cm-guide-icon">💱</div>
                <div className="cm-guide-text">
                   <strong>Swap for USDC</strong>
                   <span>Use Oku Trade to swap XTZ for USDC.</span>
                </div>
                <a 
                  href="https://oku.trade/swap?inputChain=etherlink&inToken=0x0000000000000000000000000000000000000000&outToken=0x796Ea11Fa2dD751eD01b53C372fFDB4AAa8f00F9&inAmount=" 
                  target="_blank" 
                  rel="noreferrer"
                  className="cm-guide-btn"
                >
                  Go
                </a>
             </div>

             {/* 3. Bridge */}
             <div className="cm-guide-row">
                <div className="cm-guide-icon">🌉</div>
                <div className="cm-guide-text">
                   <strong>Bridge Assets</strong>
                   <span>Move ETH or XTZ to Etherlink Mainnet.</span>
                </div>
                <a 
                  href="https://bridge.etherlink.com/" 
                  target="_blank" 
                  rel="noreferrer"
                  className="cm-guide-btn"
                >
                  Go
                </a>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
}
