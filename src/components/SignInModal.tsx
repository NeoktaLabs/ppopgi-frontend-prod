// src/components/SignInModal.tsx
import { useEffect } from "react";
import { useSession } from "../state/useSession";
import {
  ConnectEmbed,
  useActiveAccount,
  useActiveWallet,
  useDisconnect,
} from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import "./SignInModal.css";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SignInModal({ open, onClose }: Props) {
  const setSession = useSession((s) => s.set);
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const { disconnect } = useDisconnect();

  // Sync Session & Auto-Close on Connect
  useEffect(() => {
    if (!open) return;
    if (!account?.address) return;

    setSession({
      account: account.address,
      connector: "thirdweb",
    });

    // Short delay for visual feedback before closing
    const t = setTimeout(() => {
      onClose();
    }, 500);
    return () => clearTimeout(t);
  }, [account?.address, open, onClose, setSession]);

  if (!open) return null;

  return (
    <div className="sim-overlay" onMouseDown={onClose}>
      <div className="sim-card" onMouseDown={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div className="sim-header">
          <div>
            <h2 className="sim-title">Welcome to Ppopgi</h2>
            <div className="sim-subtitle">Connect your wallet to start playing</div>
          </div>
          <button className="sim-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div className="sim-body">
          
          {/* Thirdweb Embed - Configured to match the theme */}
          <div className="sim-embed-wrapper">
            <ConnectEmbed
              client={thirdwebClient}
              chain={ETHERLINK_CHAIN}
              autoConnect={false}
              theme="light" // ✅ Matches the white card
              modalSize="compact"
              showThirdwebBranding={false}
              wallets={[
                createWallet("io.metamask"),
                createWallet("walletConnect"),
                createWallet("com.coinbase.wallet"),
              ]}
            />
          </div>

          <div className="sim-footer">
            <div className="sim-note">
              By connecting, you agree to the rules of the raffle. 
              <br/>Always check the URL before signing.
            </div>

            {/* Optional Sign Out (Only if wallet state is lingering) */}
            {wallet && (
              <button 
                className="sim-disconnect-btn"
                onClick={() => disconnect(wallet)}
              >
                Disconnect current session
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
