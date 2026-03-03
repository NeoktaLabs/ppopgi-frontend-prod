// src/components/TopNav.tsx
import { useState, useEffect, memo, useRef, useCallback } from "react";
import { useWalletBalance } from "thirdweb/react";
import { thirdwebClient } from "../thirdweb/client";
import { ETHERLINK_CHAIN } from "../thirdweb/etherlink";
import { ADDRESSES } from "../config/contracts";
import { InfraStatusPill } from "./InfraStatusPill";
import "./TopNav.css";

type Page = "home" | "explore" | "dashboard" | "about" | "faq";

type Props = {
  page: Page;
  account: string | null;
  onNavigate: (p: Page) => void;
  onOpenExplore: () => void;
  onOpenDashboard: () => void;
  onOpenCreate: () => void;
  onOpenCashier: () => void;
  onOpenSignIn: () => void;
  onSignOut: () => void;
};

function short(a: string) {
  if (!a) return "—";
  return `${a.slice(0, 5)}…${a.slice(-4)}`;
}

function fmtBal(v?: string, maxDp = 4) {
  if (!v) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  return n.toLocaleString("en-US", { maximumFractionDigits: maxDp });
}

function isHidden() {
  try {
    return typeof document !== "undefined" && document.hidden;
  } catch {
    return false;
  }
}

// ✅ Toast preference (only controls pop-up announcements)
const TOAST_PREF_KEY = "ppopgi:toastEnabled";
function readToastPref(): boolean {
  try {
    const v = localStorage.getItem(TOAST_PREF_KEY);
    if (v === null) return true; // default ON
    return v === "true";
  } catch {
    return true;
  }
}

function writeToastPref(enabled: boolean) {
  try {
    localStorage.setItem(TOAST_PREF_KEY, enabled ? "true" : "false");
  } catch {}

  // ✅ IMPORTANT: defer so we don't setState in NotificationCenter during TopNav render
  try {
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("ppopgi:toast-pref", { detail: { enabled } }));
    }, 0);
  } catch {}
}

export const TopNav = memo(function TopNav({
  page,
  account,
  onNavigate,
  onOpenExplore,
  onOpenDashboard,
  onOpenCreate,
  onOpenCashier,
  onOpenSignIn,
  onSignOut,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const burgerRef = useRef<HTMLButtonElement | null>(null);

  // ✅ Dropdown (desktop wallet)
  const [walletOpen, setWalletOpen] = useState(false);
  const walletBtnRef = useRef<HTMLButtonElement | null>(null);
  const walletMenuRef = useRef<HTMLDivElement | null>(null);

  // ✅ toast announcements toggle (persisted)
  const [toastEnabled, setToastEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return readToastPref();
  });

  // ✅ Toggle without dispatching inside setState callback
  const toggleToasts = useCallback(() => {
    const next = !toastEnabled;
    setToastEnabled(next);
    writeToastPref(next);
  }, [toastEnabled]);

  // pause balance polling when tab hidden
  const [pollEnabled, setPollEnabled] = useState(() => !isHidden());

  useEffect(() => {
    setMenuOpen(false);
    setWalletOpen(false);
  }, [page]);

  // If user signs out while wallet dropdown open, close it (avoid stale menu)
  useEffect(() => {
    if (!account) setWalletOpen(false);
  }, [account]);

  // Close mobile menu on outside click / esc
  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      const clickedInsideMenu = !!menuRef.current?.contains(target);
      const clickedBurger = !!burgerRef.current?.contains(target);

      if (!clickedInsideMenu && !clickedBurger) {
        setMenuOpen(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, { capture: true } as any);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Close wallet dropdown on outside click / esc
  useEffect(() => {
    if (!walletOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      const insideMenu = !!walletMenuRef.current?.contains(target);
      const insideBtn = !!walletBtnRef.current?.contains(target);

      if (!insideMenu && !insideBtn) setWalletOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWalletOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, { capture: true } as any);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [walletOpen]);

  // keep polling off in background tabs
  useEffect(() => {
    const onVis = () => {
      const enabled = !isHidden();
      setPollEnabled(enabled);
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  // close menus when tab loses focus
  useEffect(() => {
    const onBlur = () => {
      setMenuOpen(false);
      setWalletOpen(false);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  const closeMenu = () => setMenuOpen(false);

  const handleNav = (action: () => void, targetPage?: Page) => {
    if (targetPage) onNavigate(targetPage);
    action();
    closeMenu();
  };

  const BALANCE_POLL_MS = 60_000;

  const xtzBal = useWalletBalance(
    {
      client: thirdwebClient,
      chain: ETHERLINK_CHAIN as any,
      address: account ?? undefined,
    },
    {
      enabled: !!account && pollEnabled,
      refetchInterval: BALANCE_POLL_MS,
    } as any
  );

  const usdcTokenAddr = (ADDRESSES as any).USDC?.toLowerCase?.() ?? (ADDRESSES as any).USDC;

  const usdcBal = useWalletBalance(
    {
      client: thirdwebClient,
      chain: ETHERLINK_CHAIN as any,
      address: account ?? undefined,
      tokenAddress: usdcTokenAddr,
    },
    {
      enabled: !!account && pollEnabled,
      refetchInterval: BALANCE_POLL_MS,
    } as any
  );

  // refresh balances immediately when tab becomes visible again
  useEffect(() => {
    if (!account) return;
    if (!pollEnabled) return;
    try {
      xtzBal.refetch?.();
      usdcBal.refetch?.();
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pollEnabled]);

  const xtzText = fmtBal(xtzBal.data?.displayValue, 4);
  const xtzSym = xtzBal.data?.symbol || "XTZ";

  const usdcText = fmtBal(usdcBal.data?.displayValue, 2);
  const usdcSym = usdcBal.data?.symbol || "USDC";

  const walletLabel = account ? `Player · ${short(account)}` : "Join Ppopgi (뽑기)";

  return (
    <div className="topnav-wrapper">
      <div className="topnav-shell">
        <div className="topnav-pill">
          <div className="topnav-brand" onClick={() => handleNav(() => {}, "home")}>
            <img className="topnav-logo" src="/ppopgi-logo.png" alt="Ppopgi logo" draggable={false} />
            <span className="brand-text">Ppopgi (뽑기)</span>
          </div>

          <nav className="topnav-desktop-links">
            <button
              className={`nav-link ${page === "explore" ? "active" : ""}`}
              onClick={() => handleNav(onOpenExplore, "explore")}
            >
              Explore
            </button>

            <button className="nav-link create-btn" onClick={() => handleNav(onOpenCreate)}>
              Create
            </button>
          </nav>

          <div className="topnav-right">
            <div className="desktop-actions">
              {/* ✅ Single obvious dropdown entry-point */}
              <div className="wallet-dd">
                <button
                  ref={walletBtnRef}
                  type="button"
                  className={`wallet-btn ${walletOpen ? "open" : ""}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setWalletOpen((v) => !v);
                  }}
                  aria-haspopup="menu"
                  aria-expanded={walletOpen}
                  title={account ? "Wallet menu" : "Wallet menu (sign in for balances)"}
                >
                  <span className="wallet-btn-ic">🎡</span>
                  <span className="wallet-btn-txt">{walletLabel}</span>
                  <span className="wallet-btn-caret" aria-hidden>
                    ▾
                  </span>
                </button>

                {walletOpen && (
                  <div ref={walletMenuRef} className="wallet-menu" role="menu">
                    {account ? (
                      <>
                        <div className="wallet-section">
                          <div className="wallet-sec-title">Balances</div>
                          <div className="wallet-bal">
                            <div className="wallet-bal-row">
                              <span>{usdcSym}</span>
                              <b>{usdcText}</b>
                            </div>
                            <div className="wallet-bal-row">
                              <span>{xtzSym}</span>
                              <b>{xtzText}</b>
                            </div>
                          </div>
                        </div>

                        <div className="wallet-divider" />

                        <button
                          className="wallet-item"
                          onClick={() => {
                            setWalletOpen(false);
                            onOpenCashier();
                          }}
                          role="menuitem"
                        >
                          🏦 Cashier
                        </button>

                        {/* ✅ Alerts toggle only when signed in */}
                        <button
                          className="wallet-item"
                          onClick={() => toggleToasts()}
                          role="menuitem"
                          aria-pressed={toastEnabled}
                          title={toastEnabled ? "Turn off announcement popups" : "Turn on announcement popups"}
                        >
                          {toastEnabled ? "🔔 Alerts: ON" : "🔕 Alerts: OFF"}
                        </button>

                        <button
                          className="wallet-item"
                          onClick={() => {
                            setWalletOpen(false);
                            onNavigate("dashboard");
                            onOpenDashboard();
                          }}
                          role="menuitem"
                        >
                          👤 Dashboard
                        </button>

                        <div className="wallet-divider" />

                        <button
                          className="wallet-item danger"
                          onClick={() => {
                            setWalletOpen(false);
                            onSignOut();
                          }}
                          role="menuitem"
                        >
                          Log Off ({short(account)})
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="wallet-section">
                          <div className="wallet-sec-title">Quick actions</div>
                          <div className="wallet-hint">Sign in to see balances & dashboard.</div>
                        </div>

                        <div className="wallet-divider" />

                        <button
                          className="wallet-item"
                          onClick={() => {
                            setWalletOpen(false);
                            onOpenCashier();
                          }}
                          role="menuitem"
                        >
                          🏦 Cashier
                        </button>

                        {/* ✅ REMOVED: Alerts toggle when signed out */}

                        <div className="wallet-divider" />

                        <button
                          className="wallet-item primary"
                          onClick={() => {
                            setWalletOpen(false);
                            onOpenSignIn();
                          }}
                          role="menuitem"
                        >
                          Sign In
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ✅ Mini Quick-Balance for Mobile (USDC + XTZ) */}
            {account && (
              <button className="mobile-quick-bal" onClick={() => handleNav(onOpenCashier)} aria-label="Open Cashier">
                <div className="mobile-quick-bal-rows">
                  <div className="mobile-quick-bal-row">
                    <b>{usdcText}</b>
                    <span>{usdcSym}</span>
                  </div>
                  <div className="mobile-quick-bal-row">
                    <b>{xtzText}</b>
                    <span>{xtzSym}</span>
                  </div>
                </div>
              </button>
            )}

            <button
              ref={burgerRef}
              className={`mobile-burger ${menuOpen ? "open" : ""}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
            >
              <span />
              <span />
            </button>
          </div>
        </div>

        {/* Infra row (kept as-is) */}
        <div className="topnav-infra">
          <InfraStatusPill />
        </div>
      </div>

      {/* ✅ Mobile menu */}
      <div ref={menuRef} className={`mobile-menu ${menuOpen ? "visible" : ""}`}>
        <div className="mobile-menu-inner">
          {account && (
            <div className="mobile-balances" onClick={() => handleNav(onOpenCashier)}>
              <div className="mobile-balances-title">Balances</div>
              <div className="mobile-balances-rows">
                <div className="mobile-bal-row">
                  <span>{usdcSym}</span>
                  <b>{usdcText}</b>
                </div>
                <div className="mobile-bal-row">
                  <span>{xtzSym}</span>
                  <b>{xtzText}</b>
                </div>
              </div>
            </div>
          )}

          <button onClick={() => handleNav(onOpenExplore, "explore")}>🌍 Explore</button>

          {account && <button onClick={() => handleNav(onOpenDashboard, "dashboard")}>👤 Dashboard</button>}

          <button className="highlight" onClick={() => handleNav(onOpenCreate)}>
            ✨ Create Lottery
          </button>

          <div className="mobile-divider" />

          <button onClick={() => handleNav(onOpenCashier)}>🏦 Cashier</button>

          {/* ✅ Alerts toggle only when signed in */}
          {account && (
            <button
              onClick={() => {
                toggleToasts();
                closeMenu();
              }}
            >
              {toastEnabled ? "🔔 Alerts: ON" : "🔕 Alerts: OFF"}
            </button>
          )}

          {!account ? (
            <button className="primary" onClick={() => handleNav(onOpenSignIn)}>
              Sign In
            </button>
          ) : (
            <button className="danger" onClick={() => handleNav(onSignOut)}>
              Log Off ({short(account)})
            </button>
          )}
        </div>
      </div>
    </div>
  );
});