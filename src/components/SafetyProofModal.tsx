// src/components/SafetyProofModal.tsx
import type { LotteryDetails } from "../hooks/useLotteryDetails";
import { useSafetyBreakdown } from "../hooks/useSafetyBreakdown";
import "./SafetyProofModal.css";

type Props = {
  open: boolean;
  onClose: () => void;
  lottery?: LotteryDetails | null;
};

const ZERO = "0x0000000000000000000000000000000000000000";

// Helper: Clickable Link
const ExplorerLink = ({ addr, label }: { addr?: string; label: string }) => {
  const a = String(addr || "");
  if (!a || a.toLowerCase() === ZERO) return <span className="sp-mono">—</span>;
  return (
    <a
      href={`https://explorer.etherlink.com/address/${a}`}
      target="_blank"
      rel="noreferrer"
      className="sp-link"
      title={a}
    >
      {label} ↗
    </a>
  );
};

const short = (s?: string) => (s ? `${s.slice(0, 6)}...${s.slice(-4)}` : "—");

const copy = (v?: string) => {
  if (!v) return;
  try {
    navigator.clipboard.writeText(v);
  } catch {}
};

function fmtPct(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? `${n}%` : "—";
}

function secondsToHuman(s: number) {
  if (!Number.isFinite(s) || s <= 0) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function SafetyProofModal({ open, onClose, lottery }: Props) {
  useSafetyBreakdown(lottery as any);

  if (!open) return null;

  if (!lottery) {
    return (
      <div className="sp-overlay" onMouseDown={onClose}>
        <div className="sp-card" onMouseDown={(e) => e.stopPropagation()}>
          <div className="sp-header">
            <div className="sp-header-left">
              <div className="sp-shield-icon">🛡️</div>
              <div>
                <h3 className="sp-title">Transparency & Safety</h3>
                <div className="sp-subtitle">Loading contract safety proof…</div>
              </div>
            </div>
            <button className="sp-close-btn" onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="sp-body">
            <div className="sp-panel sp-tech-panel">
              <div className="sp-panel-header">
                <span>Fetching lottery safety data</span>
              </div>
              <div className="sp-footnote">
                Please wait a moment while we load the contract details and randomness configuration.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const entropyAddr = (lottery as any).entropy as string | undefined;
  const feeRecipient = (lottery as any).feeRecipient as string | undefined;
  const protocolFeePercent = (lottery as any).protocolFeePercent as any;

  const drawingRequestedAt = Number((lottery as any).drawingRequestedAt || 0);
  const isHatchOpen = Boolean((lottery as any).isHatchOpen);
  const nowSec = Math.floor(Date.now() / 1000);

  const HATCH_DELAY_SEC = 2 * 60 * 60;

  const drawingAgeSec =
    drawingRequestedAt > 0 && nowSec >= drawingRequestedAt ? nowSec - drawingRequestedAt : 0;

  const hatchOpensInSec =
    drawingRequestedAt > 0 ? Math.max(0, HATCH_DELAY_SEC - drawingAgeSec) : 0;

  return (
    <div className="sp-overlay" onMouseDown={onClose}>
      <div className="sp-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sp-header">
          <div className="sp-header-left">
            <div className="sp-shield-icon">🛡️</div>
            <div>
              <h3 className="sp-title">Transparency & Safety</h3>
              <div className="sp-subtitle">Immutable • Non-custodial • Publicly verifiable</div>
            </div>
          </div>
          <button className="sp-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="sp-body">
          <div className="sp-section-grid">
            <div className="sp-data-box">
              <div className="sp-lbl">Contract status</div>
              <span className={`sp-status-pill ${String(lottery.status || "").toLowerCase()}`}>
                {String(lottery.status || "").replace("_", " ")}
              </span>
            </div>

            <div className="sp-data-box">
              <div className="sp-lbl">Lottery address</div>
              <ExplorerLink addr={lottery.address} label={short(lottery.address)} />
            </div>

            <div className="sp-data-box">
              <div className="sp-lbl">Asset token</div>
              <ExplorerLink addr={lottery.usdcToken} label="USDC (ERC-20)" />
            </div>

            <div className="sp-data-box">
              <div className="sp-lbl">Creator</div>
              <ExplorerLink addr={lottery.creator} label={short(lottery.creator)} />
            </div>
          </div>

          <div className="sp-panel sp-tech-panel">
            <div className="sp-panel-header">
              <span>📌 Immutable config (set at deployment)</span>
            </div>

            <div className="sp-tech-grid">
              <div className="sp-tech-row">
                <div className="sp-k">Protocol fee</div>
                <div className="sp-v">
                  <span className="sp-mono">{fmtPct(protocolFeePercent)}</span>
                  <div className="sp-tech-note">
                    This percent is stored in the lottery contract and used at settlement time (applies to pot + ticket revenue).
                  </div>
                </div>
              </div>

              <div className="sp-tech-row">
                <div className="sp-k">Fee recipient</div>
                <div className="sp-v">
                  <ExplorerLink addr={feeRecipient} label={short(feeRecipient)} />
                  <div className="sp-tech-note">
                    This address can claim protocol fees allocated by the contract. It is not editable for this lottery.
                  </div>
                </div>
              </div>

              <div className="sp-tech-row">
                <div className="sp-k">Entropy contract</div>
                <div className="sp-v">
                  <ExplorerLink addr={entropyAddr} label={short(entropyAddr)} />
                  <div className="sp-tech-note">
                    The lottery contract only accepts randomness callbacks if <strong>msg.sender</strong> equals this Entropy contract.
                  </div>
                </div>
              </div>

              <div className="sp-tech-row">
                <div className="sp-k">Entropy provider</div>
                <div className="sp-v">
                  <ExplorerLink addr={lottery.entropyProvider} label={short(lottery.entropyProvider)} />
                </div>
              </div>
            </div>
          </div>

          <div className="sp-panel sp-flow-panel">
            <div className="sp-panel-header">
              <span>🎲 How the winner is chosen</span>
              <span className="sp-flow-pill active">Verifiable</span>
            </div>

            <div className="sp-flow">
              <div className="sp-step">
                <div className="sp-step-num">1</div>
                <div>
                  <div className="sp-step-title">Anyone can finalize when eligible</div>
                  <div className="sp-step-text">
                    When the lottery is sold out or the deadline passes, <code>finalize()</code> can be called by anyone (including an automated bot).
                  </div>
                </div>
              </div>

              <div className="sp-step">
                <div className="sp-step-num">2</div>
                <div>
                  <div className="sp-step-title">Lottery requests Entropy randomness</div>
                  <div className="sp-step-text">
                    The lottery requests a random value from Pyth Entropy and stores the request ID on-chain.
                  </div>
                </div>
              </div>

              <div className="sp-step">
                <div className="sp-step-num">3</div>
                <div>
                  <div className="sp-step-title">Winner is selected by contract math</div>
                  <div className="sp-step-text">
                    The contract computes <code>winningIndex = random % totalSold</code> and maps the winning ticket to a buyer using on-chain ranges.
                    No admin can override this.
                  </div>
                </div>
              </div>
            </div>

            <div className="sp-mini-note">
              This process is publicly auditable on-chain: request → callback → winner selection → claim allocations.
            </div>
          </div>

          <div className="sp-panel sp-tech-panel">
            <div className="sp-panel-header">
              <span>🚨 Safety fallback (if randomness is delayed)</span>
            </div>

            <div className="sp-tech-grid">
              <div className="sp-tech-row">
                <div className="sp-k">Emergency hatch</div>
                <div className="sp-v">
                  <span className="sp-mono">
                    {drawingRequestedAt > 0
                      ? isHatchOpen
                        ? "OPEN"
                        : `opens in ~${secondsToHuman(hatchOpensInSec)}`
                      : "—"}
                  </span>
                  <div className="sp-tech-note">
                    If a lottery stays in <b>Drawing</b> too long, your contract allows a <b>permissionless</b> emergency cancel after a safety delay
                    (2 hours). This routes funds back into the normal claim/refund flow.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="sp-panel sp-tech-panel">
            <div className="sp-panel-header">
              <span>🔎 Verify randomness yourself</span>
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
                    <span className="sp-mono">{lottery.address}</span>
                    <button className="sp-copy-btn" onClick={() => copy(lottery.address)} title="Copy sender address">
                      📋
                    </button>
                  </div>
                  <div className="sp-tech-note">
                    In the Entropy explorer, find a request where the <strong>sender</strong> equals this lottery address.
                  </div>
                </div>
              </div>

              <div className="sp-tech-row">
                <div className="sp-k">Entropy provider</div>
                <div className="sp-v">
                  <ExplorerLink addr={lottery.entropyProvider} label={short(lottery.entropyProvider)} />
                </div>
              </div>
            </div>

            <div className="sp-footnote">
              Anyone can independently confirm the randomness request/callback and verify the winner selection is computed by the contract.
            </div>
          </div>

          <div className="sp-panel sp-tech-panel">
            <div className="sp-panel-header">
              <span>🔐 Fund custody model</span>
            </div>

            <div className="sp-tech-grid">
              <div className="sp-tech-row">
                <div className="sp-k">Custody</div>
                <div className="sp-v">
                  <div className="sp-tech-note" style={{ marginTop: 0 }}>
                    USDC is held by the lottery contract. Payouts are <b>pull-based</b>: the contract allocates claimable balances and
                    each user claims their own funds. There is no function intended to “drain everything to an arbitrary address”.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}