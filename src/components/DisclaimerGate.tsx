// src/components/DisclaimerGate.tsx

import "./DisclaimerGate.css";

type Props = {
  open: boolean;
  onAccept: () => void;
};

export function DisclaimerGate({ open, onAccept }: Props) {
  if (!open) return null;

  return (
    <div className="dg-overlay">
      <div className="dg-card" role="dialog" aria-modal="true">
        
        {/* Header with Icon */}
        <div className="dg-header">
          <div className="dg-icon">⚠️</div>
          <h1 className="dg-title">Before you enter</h1>
        </div>

        <div className="dg-body">
          <p className="dg-text">
            Ppopgi is a decentralized, experimental application running on the Etherlink Mainnet.
            By continuing, you acknowledge and agree to the following:
          </p>

          <ul className="dg-list">
            <li>
              <strong>No Guarantees:</strong> The protocol is provided "as is" without warranty of any kind.
            </li>
            <li>
              <strong>User Responsibility:</strong> You are solely responsible for your funds and interactions.
            </li>
            <li>
              <strong>Risk Awareness:</strong> Only participate with assets you can afford to lose.
            </li>
          </ul>

          <button className="dg-accept-btn" onClick={onAccept}>
            I Understand & Agree
          </button>

          <div className="dg-footer">
            Transactions are irreversible. Please proceed with caution.
          </div>
        </div>
      </div>
    </div>
  );
}
