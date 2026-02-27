// src/components/CashierModal.tsx
import { useMemo, useState, useCallback } from "react";
import { useCashierData } from "../hooks/useCashierData";
import "./CashierModal.css";

import { BuyWidget } from "thirdweb/react";
import { NATIVE_TOKEN_ADDRESS } from "thirdweb";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import { ADDRESSES } from "../config/contracts";

type Props = {
  open: boolean;
  onClose: () => void;
};

type Tab = "buy_usdc" | "buy_xtz" | "bridge";

export function CashierModal({ open, onClose }: Props) {
  const { state, actions, display } = useCashierData(open);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab>("buy_usdc");

  // ✅ Keep as Address (do NOT .toLowerCase(); it turns it into plain string)
  const USDC_ADDRESS = useMemo(() => ADDRESSES.USDC, []);

  const handleCopy = useCallback(() => {
    const addr = state.me;
    if (!addr) return;

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(addr);
      } else {
        window.prompt("Copy address:", addr);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [state.me]);

  // ✅ Provide explicit token info so the widget doesn't need to fetch metadata
  const supportedTokens = useMemo(() => {
    return {
      [ETHERLINK_CHAIN.id]: [
        { address: NATIVE_TOKEN_ADDRESS, symbol: "XTZ", name: "Tezos" },
        { address: USDC_ADDRESS, symbol: "USDC", name: "USD Coin" },
      ],
    };
  }, [USDC_ADDRESS]);

  const ETHERLINK_BRIDGE_URL = "https://bridge.etherlink.com/";

  if (!open) return null;

  return (
    <div className="cm-overlay" onMouseDown={onClose}>
      <div className="cm-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cm-header">
          <h3 className="cm-title">Cashier</h3>
          <button className="cm-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="cm-body">
          <div className="cm-address-row">
            <div
              className="cm-avatar-circle"
              style={{
                background: copied ? "#dcfce7" : "#f1f5f9",
                color: copied ? "#166534" : "#64748b",
              }}
            >
              {copied ? "✓" : "👤"}
            </div>

            <div className="cm-address-info">
              <div className="cm-label">Connected Account</div>
              <div className="cm-addr-val" onClick={handleCopy} title={state.me ? "Click to Copy" : ""}>
                {display.shortAddr}
                {state.me && <span className="cm-copy-icon">{copied ? "Copied" : "Copy"}</span>}
              </div>
            </div>

            <button className="cm-refresh-btn" onClick={actions.refresh} disabled={state.loading}>
              {state.loading ? "..." : "🔄"}
            </button>
          </div>

          {state.note && <div className="cm-alert">⚠️ {state.note}</div>}

          <div className="cm-balance-section">
            <div className="cm-section-label">Assets on Etherlink</div>

            <div className="cm-balance-grid">
              <div className="cm-asset-card primary">
                <div className="cm-asset-icon">💲</div>
                <div>
                  <div className="cm-asset-amount">{display.usdc}</div>
                  <div className="cm-asset-name">USDC</div>
                </div>
                <div className="cm-asset-tag">Lottery Funds</div>
              </div>

              <div className="cm-asset-card secondary">
                <div className="cm-asset-icon">⛽</div>
                <div>
                  <div className="cm-asset-amount">{display.xtz}</div>
                  <div className="cm-asset-name">Tezos (XTZ)</div>
                </div>
                <div className="cm-asset-tag">Gas</div>
              </div>
            </div>
          </div>

          <div className="cm-tabs3">
            <button className={`cm-tab3 ${tab === "buy_usdc" ? "active" : ""}`} onClick={() => setTab("buy_usdc")}>
              Buy USDC
            </button>
            <button className={`cm-tab3 ${tab === "buy_xtz" ? "active" : ""}`} onClick={() => setTab("buy_xtz")}>
              Buy XTZ
            </button>
            <button className={`cm-tab3 ${tab === "bridge" ? "active" : ""}`} onClick={() => setTab("bridge")}>
              Bridge
            </button>
          </div>

          <div className="cm-widget-shell">
            {tab === "buy_usdc" && (
              <div className="cm-widget-wrap">
                <BuyWidget
                  key="buy_usdc"
                  client={thirdwebClient}
                  chain={ETHERLINK_CHAIN}
                  theme="light"
                  title="Buy USDC"
                  tokenAddress={USDC_ADDRESS}
                  tokenEditable={false}
                  amountEditable={true}
                  supportedTokens={supportedTokens}
                  paymentMethods={["crypto", "card"]}
                  style={{ width: "100%" }}
                />
              </div>
            )}

            {tab === "buy_xtz" && (
              <div className="cm-widget-wrap">
                <BuyWidget
                  key="buy_xtz"
                  client={thirdwebClient}
                  chain={ETHERLINK_CHAIN}
                  theme="light"
                  title="Buy XTZ"
                  tokenAddress={NATIVE_TOKEN_ADDRESS}
                  tokenEditable={false}
                  amountEditable={true}
                  supportedTokens={supportedTokens}
                  paymentMethods={["crypto", "card"]}
                  style={{ width: "100%" }}
                />
              </div>
            )}

            {tab === "bridge" && (
              <div className="cm-bridge-box">
                <div className="cm-bridge-header">
                  <span className="cm-bridge-route">Ethereum L1</span>
                  <span className="cm-bridge-arrow">➝</span>
                  <span className="cm-bridge-route highlight">Etherlink L2</span>
                </div>

                <div className="cm-bridge-title">Deposit Funds</div>
                <div className="cm-bridge-text">
                  Already have funds on Ethereum Mainnet? Use the official bridge to move <b>USDC</b> or <b>XTZ</b> over
                  to Etherlink.
                </div>

                <a className="cm-bridge-btn" href={ETHERLINK_BRIDGE_URL} target="_blank" rel="noreferrer">
                  Open Official Bridge ↗
                </a>

                <div className="cm-bridge-footnote">Bridging typically takes ~15-20 minutes.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}