// src/components/SignInModal.tsx
import { useEffect, useMemo, useState } from "react";
import { useSession } from "../state/useSession";
import {
  ConnectEmbed,
  useActiveAccount,
  useActiveWallet,
  useConnect,
  useDisconnect,
} from "thirdweb/react";
import { createWallet, inAppWallet } from "thirdweb/wallets";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import { useLedgerUsbWallet } from "../hooks/ledgerUsbWallet";
import "./SignInModal.css";

type Props = {
  open: boolean;
  onClose: () => void;
};

const shortAddr = (a: string) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "—");

const LEDGER_PATH_PRESETS = [
  { id: "ledgerlive", label: "Ledger Live", base: "44'/60'/0'/0" },
  { id: "legacy", label: "Legacy", base: "44'/60'/0'" },
  { id: "bip44", label: "BIP44 (Metamask-style)", base: "44'/60'/0'/0" },
];

export function SignInModal({ open, onClose }: Props) {
  const setSession = useSession((s) => s.set);
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const { disconnect } = useDisconnect();

  const { connect, isConnecting, error: connectError } = useConnect({ client: thirdwebClient });

  const {
    ensureLedgerDevice,
    connectLedgerUsb,
    isSupported: isLedgerSupported,
    isConnecting: isLedgerConnecting,
    error: ledgerError,
    scanAccounts,
    setSelectedPath,
  } = useLedgerUsbWallet();

  const [localError, setLocalError] = useState("");

  // Picker modal state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pathPreset, setPathPreset] = useState(LEDGER_PATH_PRESETS[0]);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanRows, setScanRows] = useState<{ path: string; address: string }[]>([]);
  const [selectedRow, setSelectedRow] = useState<{ path: string; address: string } | null>(null);

  const errorMessage = useMemo(() => {
    return localError || ledgerError || (connectError ? String(connectError.message || connectError) : "") || "";
  }, [localError, ledgerError, connectError]);

  // Sync Session & Auto-close on connect
  useEffect(() => {
    if (!open) return;
    if (!account?.address) return;

    setSession({ account: account.address, connector: "thirdweb" });

    const t = setTimeout(() => onClose(), 500);
    return () => clearTimeout(t);
  }, [account?.address, open, onClose, setSession]);

  // Reset picker when modal opens
  useEffect(() => {
    if (!open) return;
    setLocalError("");
    setPickerOpen(false);
    setScanRows([]);
    setSelectedRow(null);
    setScanBusy(false);
    setPathPreset(LEDGER_PATH_PRESETS[0]);
  }, [open]);

  const openLedgerPicker = async () => {
    setLocalError("");

    if (!isLedgerSupported) {
      setLocalError("Ledger USB requires Chrome/Edge/Brave (WebHID).");
      return;
    }

    try {
      // Must be called from the button click to guarantee HID chooser prompt
      await ensureLedgerDevice();

      // Open picker modal AFTER we have device permission
      setPickerOpen(true);
    } catch (e: any) {
      setLocalError(e?.message ? String(e.message) : "Failed to select Ledger device.");
    }
  };

  const doScan = async () => {
    setLocalError("");
    setScanBusy(true);
    setSelectedRow(null);

    try {
      const rows = await scanAccounts({
        basePath: pathPreset.base,
        startIndex: 0,
        count: 10,
      });
      setScanRows(rows);
    } catch (e: any) {
      setLocalError(e?.message ? String(e.message) : "Failed to scan Ledger accounts.");
    } finally {
      setScanBusy(false);
    }
  };

  const confirmLedgerSelection = async () => {
    if (!selectedRow) return;

    setLocalError("");
    try {
      // Create/open a session at the chosen path so the provider uses it
      await setSelectedPath(selectedRow.path);

      await connect(async () => {
        const w = await connectLedgerUsb({
          client: thirdwebClient,
          chain: ETHERLINK_CHAIN,
          preferredPath: selectedRow.path,
        });
        return w;
      });

      setPickerOpen(false);
    } catch (e: any) {
      setLocalError(e?.message ? String(e.message) : "Failed to connect Ledger.");
    }
  };

  if (!open) return null;

  return (
    <div className="sim-overlay" onMouseDown={onClose}>
      <div className="sim-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sim-header">
          <div>
            <h2 className="sim-title">Welcome to Ppopgi (뽑기)</h2>
            <div className="sim-subtitle">Connect your wallet to start playing</div>
          </div>
          <button className="sim-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="sim-body">
          {/* Ledger Section */}
          <div className="sim-ledger-section">
            <button
              className="sim-ledger-btn"
              onClick={openLedgerPicker}
              disabled={!isLedgerSupported || isConnecting || isLedgerConnecting}
              title={!isLedgerSupported ? "Ledger USB requires Chrome/Edge/Brave (WebHID)" : ""}
            >
              <span className="sim-ledger-btn-text">
                {isLedgerConnecting ? "Connecting Ledger..." : "Connect Ledger (USB)"}
              </span>
              <span className="sim-ledger-badge">Chromium</span>
            </button>

            <div className="sim-ledger-hint">
              Plug in your Ledger, unlock it, and open the <b>Ethereum</b> app.
              <br />
              (Chrome / Edge / Brave only)
            </div>

            {errorMessage && <div className="sim-error">{errorMessage}</div>}
          </div>

          {/* Ledger Picker Modal */}
          {pickerOpen && (
            <div className="sim-overlay" style={{ zIndex: 9999 }} onMouseDown={() => setPickerOpen(false)}>
              <div className="sim-card" onMouseDown={(e) => e.stopPropagation()}>
                <div className="sim-header">
                  <div>
                    <h2 className="sim-title">Select Account</h2>
                    <div className="sim-subtitle">Choose a derivation path and pick an address</div>
                  </div>
                  <button className="sim-close-btn" onClick={() => setPickerOpen(false)}>
                    ✕
                  </button>
                </div>

                <div className="sim-body">
                  <div className="sim-picker-row">
                    <label className="sim-picker-label">Path</label>
                    <select
                      className="sim-select"
                      value={pathPreset.id}
                      onChange={(e) => {
                        const next =
                          LEDGER_PATH_PRESETS.find((p) => p.id === e.target.value) || LEDGER_PATH_PRESETS[0];
                        setPathPreset(next);
                        setScanRows([]);
                        setSelectedRow(null);
                      }}
                    >
                      {LEDGER_PATH_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label} ({p.base}/0)
                        </option>
                      ))}
                    </select>

                    <button className="sim-scan-btn" onClick={doScan} disabled={scanBusy}>
                      {scanBusy ? "Scanning" : "Scan"}
                    </button>
                  </div>

                  {scanRows.length > 0 ? (
                    <div className="sim-address-list">
                      {scanRows.map((row) => {
                        const picked = selectedRow?.path === row.path;
                        return (
                          <button
                            key={row.path}
                            className={`sim-address-item ${picked ? "selected" : ""}`}
                            onClick={() => setSelectedRow(row)}
                          >
                            <div className="sim-address-val">{shortAddr(row.address)}</div>
                            <div className="sim-address-path">{row.path}</div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="sim-empty-msg">
                      Click <b>Scan</b> to fetch Ledger addresses.
                    </div>
                  )}

                  <button
                    className="sim-ledger-btn"
                    onClick={confirmLedgerSelection}
                    disabled={!selectedRow || isConnecting || isLedgerConnecting}
                  >
                    Use selected address
                  </button>

                  <div className="sim-footer-hint">
                    Make sure the <b>Ethereum app</b> is open on your Ledger.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="sim-divider">
            <span>or</span>
          </div>

          {/* Social + Email + Wallets */}
          <div className="sim-embed-wrapper">
            <ConnectEmbed
              client={thirdwebClient}
              chain={ETHERLINK_CHAIN}
              autoConnect={false}
              theme="light"
              modalSize="compact"
              showThirdwebBranding={false}
              wallets={[
                inAppWallet({
                  auth: {
                    options: [
                      "email",
                      "google",
                      "apple",
                      "x",
                      "discord",
                      "tiktok",
                      "telegram",
                      "line",
                      "phone",
                      "passkey",
                      "facebook",
                    ],
                  },
                  metadata: { name: "Ppopgi" },
                }),
                createWallet("io.metamask"),
                createWallet("walletConnect"),
                createWallet("com.coinbase.wallet"),
              ]}
            />
          </div>

          <div className="sim-footer">
            <div className="sim-note">
              By connecting, you agree to the rules of the lottery.
              <br />
              Always check the URL before signing.
            </div>

            {wallet && (
              <button className="sim-disconnect-btn" onClick={() => disconnect(wallet)}>
                Disconnect current session
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SignInModal;