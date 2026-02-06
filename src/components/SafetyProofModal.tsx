import type { RaffleDetails } from "../hooks/useRaffleDetails";
import { useSafetyBreakdown } from "../hooks/useSafetyBreakdown";
import "./SafetyProofModal.css";

type Props = {
  open: boolean;
  onClose: () => void;
  raffle: RaffleDetails;
};

// Helper: Clickable Link
const ExplorerLink = ({ addr, label }: { addr?: string; label: string }) => {
  if (!addr || addr === "0x0000000000000000000000000000000000000000") {
    return <span className="sp-mono">—</span>;
  }
  return (
    <a
      href={`https://explorer.etherlink.com/address/${addr}`}
      target="_blank"
      rel="noreferrer"
      className="sp-link"
      title={addr}
    >
      {label} ↗
    </a>
  );
};

const short = (s?: string) => (s ? `${s.slice(0, 6)}...${s.slice(-4)}` : "—");

const copy = (v?: string) => {
  if (!v) return;
  navigator.clipboard.writeText(v);
};

export function SafetyProofModal({ open, onClose, raffle }: Props) {
  useSafetyBreakdown(raffle); // kept for consistency / future use

  if (!open) return null;

  return (
    <div className="sp-overlay" onMouseDown={onClose}>
      <div className="sp-card" onMouseDown={(e) => e.stopPropagation()}>
        {/* HEADER */}
        <div className="sp-header">
          <div className="sp-header-left">
            <div className="sp-shield-icon">🛡️</div>
            <div>
              <h3 className="sp-title">Verified & Fair Randomness</h3>
              <div className="sp-subtitle">
                Immutable • Non-custodial • Publicly verifiable
              </div>
            </div>
          </div>
          <button className="sp-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="sp-body">
          {/* KEY FACTS */}
          <div className="sp-section-grid">
            <div className="sp-data-box">
              <div className="sp-lbl">Contract status</div>
              <span className={`sp-status-pill ${raffle.status.toLowerCase()}`}>
                {raffle.status.replace("_", " ")}
              </span>
            </div>

            <div className="sp-data-box">
              <div className="sp-lbl">Raffle address</div>
              <ExplorerLink
                addr={raffle.address}
                label={short(raffle.address)}
              />
            </div>

            <div className="sp-data-box">
              <div className="sp-lbl">Asset token</div>
              <ExplorerLink addr={raffle.usdcToken} label="USDC (ERC-20)" />
            </div>

            <div className="sp-data-box">
              <div className="sp-lbl">Creator</div>
              <ExplorerLink
                addr={raffle.creator}
                label={short(raffle.creator)}
              />
            </div>
          </div>

          {/* HOW RANDOMNESS WORKS */}
          <div className="sp-panel sp-flow-panel">
            <div className="sp-panel-header">
              <span>🎲 How the winner is chosen</span>
              <span className="sp-flow-pill active">Unmanipulable</span>
            </div>

            <div className="sp-flow">
              <div className="sp-step">
                <div className="sp-step-num">1</div>
                <div>
                  <div className="sp-step-title">
                    Raffle requests randomness
                  </div>
                  <div className="sp-step-text">
                    Once ticket sales end, the raffle smart contract sends a
                    randomness request to the entropy network.
                  </div>
                </div>
              </div>

              <div className="sp-step">
                <div className="sp-step-num">2</div>
                <div>
                  <div className="sp-step-title">
                    Entropy network generates randomness
                  </div>
                  <div className="sp-step-text">
                    The entropy provider produces randomness off-chain and
                    publishes it back on-chain with cryptographic proof.
                  </div>
                </div>
              </div>

              <div className="sp-step">
                <div className="sp-step-num">3</div>
                <div>
                  <div className="sp-step-title">
                    Winner is selected automatically
                  </div>
                  <div className="sp-step-text">
                    The raffle contract uses the returned randomness to select a
                    winner. No one — not the creator, not Ppopgi — can interfere.
                  </div>
                </div>
              </div>
            </div>

            <div className="sp-mini-note">
              This entire process is on-chain and publicly auditable.
            </div>
          </div>

          {/* VERIFY YOURSELF */}
          <div className="sp-panel sp-tech-panel">
            <div className="sp-panel-header">
              <span>🔎 Verify the randomness yourself</span>
            </div>

            <div className="sp-tech-grid">
              <div className="sp-tech-row">
                <div className="sp-k">Entropy explorer</div>
                <div className="sp-v">
                  <a
                    href="https://entropy-explorer.pyth.network/?chain=etherlink-mainnet"
                    target="_blank"
                    rel="noreferrer"
                    className="sp-link"
                  >
                    entropy-explorer.pyth.network ↗
                  </a>
                </div>
              </div>

              <div className="sp-tech-row">
                <div className="sp-k">Sender address</div>
                <div className="sp-v">
                  <div className="sp-inline">
                    <span className="sp-mono">{raffle.address}</span>
                    <button
                      className="sp-copy-btn"
                      onClick={() => copy(raffle.address)}
                      title="Copy sender address"
                    >
                      📋
                    </button>
                  </div>
                  <div className="sp-tech-note">
                    In the entropy explorer, look for a request where the{" "}
                    <strong>sender</strong> equals this raffle address.
                  </div>
                </div>
              </div>

              <div className="sp-tech-row">
                <div className="sp-k">Entropy provider</div>
                <div className="sp-v">
                  <ExplorerLink
                    addr={raffle.entropyProvider}
                    label={short(raffle.entropyProvider)}
                  />
                </div>
              </div>
            </div>

            <div className="sp-footnote">
              Anyone can independently confirm that the randomness used to select
              the winner originated from the entropy network and was not
              manipulated.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}