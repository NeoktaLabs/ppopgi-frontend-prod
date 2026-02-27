// src/components/DisclaimerGate.tsx

import { useRef, useState, useEffect } from "react";
import "./DisclaimerGate.css";

type Props = {
  open: boolean;
  onAccept: () => void;
};

export function DisclaimerGate({ open, onAccept }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const threshold = 8; // small tolerance
      const reached =
        el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
      if (reached) setAtBottom(true);
    };

    el.addEventListener("scroll", handleScroll);
    handleScroll(); // check on mount

    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  if (!open) return null;

  return (
    <div className="dg-overlay">
      <div className="dg-card" role="dialog" aria-modal="true">
        <div className="dg-header">
          <div className="dg-icon">⚠️</div>
          <h1 className="dg-title">Before you enter</h1>
        </div>

        {/* ✅ Scrollable content */}
        <div ref={scrollRef} className="dg-scroll">
          <div className="dg-body">
            <p className="dg-text">
              Ppopgi is an experimental, unaudited decentralized application running on Etherlink.
              By entering, you acknowledge and agree to the following:
            </p>

            <ul className="dg-list">
              <li>
                <strong>Experimental Technology:</strong> Smart contracts, infrastructure, and UI are provided "as is"
                and may contain bugs, experience downtime, or behave unexpectedly.
              </li>

              <li>
                <strong>Risk of Loss:</strong> Funds may be lost due to smart contract bugs, exploits, user error,
                or failures across blockchain, wallet, or infrastructure layers.
              </li>

              <li>
                <strong>No Liability:</strong> Ppopgi and its contributors are not responsible for any financial loss,
                damages, or issues arising from the use of this application.
              </li>

              <li>
                <strong>Your Responsibility:</strong> You are solely responsible for your wallet, assets, transactions,
                and any risks taken while interacting with the protocol.
              </li>
            </ul>
          </div>
        </div>

        {/* ✅ Fixed actions */}
        <div className="dg-actions">
          <button
            className="dg-accept-btn"
            onClick={onAccept}
            disabled={!atBottom}
            style={{
              opacity: atBottom ? 1 : 0.5,
              cursor: atBottom ? "pointer" : "not-allowed",
            }}
          >
            {atBottom ? "Agree and take me to Ppopgi" : "Scroll to continue"}
          </button>

          <div className="dg-footer">
            Only participate with assets you can afford to lose.<br />
            All blockchain transactions are irreversible.
          </div>
        </div>
      </div>
    </div>
  );
}