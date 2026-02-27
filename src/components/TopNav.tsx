// src/components/TopNav.tsx
import { useState, useEffect, memo, useRef } from "react";
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

  // ✅ pause balance polling when tab hidden
  const [pollEnabled, setPollEnabled] = useState(() => !isHidden());

  useEffect(() => {
    setMenuOpen(false);
  }, [page]);

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

  // ✅ keep polling off in background tabs
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

  // (optional UX) close mobile menu when tab loses focus
  useEffect(() => {
    const onBlur = () => setMenuOpen(false);
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

  // ✅ refresh balances immediately when tab becomes visible again
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

  return (
    <div className="topnav-wrapper">
      {/* ✅ ONE single “header shell” (nav + infra are inside the same glass container) */}
      <div className="topnav-shell">
        {/* NAV ROW */}
        <div className="topnav-pill">
          <div className="topnav-brand" onClick={() => handleNav(() => {}, "home")}>
            <img className="topnav-logo" src="/ppopgi-logo.png" alt="Ppopgi logo" draggable={false} />
            <span className="brand-text">Ppopgi</span>
          </div>

          <nav className="topnav-desktop-links">
            <button
              className={`nav-link ${page === "explore" ? "active" : ""}`}
              onClick={() => handleNav(onOpenExplore, "explore")}
            >
              Explore
            </button>

            {account && (
              <button
                className={`nav-link ${page === "dashboard" ? "active" : ""}`}
                onClick={() => handleNav(onOpenDashboard, "dashboard")}
              >
                Dashboard
              </button>
            )}

            <button className="nav-link create-btn" onClick={() => handleNav(onOpenCreate)}>
              Create
            </button>
          </nav>

          <div className="topnav-right">
            <div className="desktop-actions">
              {account ? (
                <button
                  className="balances-pill"
                  onClick={() => handleNav(onOpenCashier)}
                  title="Open Cashier"
                  type="button"
                >
                  <div className="balances-rows">
                    <div className="bal-row">
                      <span className="bal-sym">{xtzSym}</span>
                      <span className="bal-val">{xtzText}</span>
                    </div>
                    <div className="bal-row">
                      <span className="bal-sym">{usdcSym}</span>
                      <span className="bal-val">{usdcText}</span>
                    </div>
                  </div>
                </button>
              ) : (
                <button className="nav-link cashier-btn" onClick={() => handleNav(onOpenCashier)} title="Open Cashier">
                  🏦 Cashier
                </button>
              )}

              {!account ? (
                <button className="nav-link primary-pill-btn" onClick={() => handleNav(onOpenSignIn)}>
                  Sign In
                </button>
              ) : (
                <button
                  type="button"
                  className="nav-link primary-pill-btn"
                  onClick={() => handleNav(onSignOut)}
                  title="Log Off"
                >
                  <div className="acct-stack">
                    <div className="acct-top">Log Off</div>
                    <div className="acct-bottom">{short(account)}</div>
                  </div>
                </button>
              )}
            </div>

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

        {/* INFRA ROW (now “wired” inside the same header shell) */}
        <div className="topnav-infra">
          <InfraStatusPill />
        </div>
      </div>

      {/* MOBILE MENU (still anchored to the whole header shell) */}
      <div ref={menuRef} className={`mobile-menu ${menuOpen ? "visible" : ""}`}>
        <div className="mobile-menu-inner">
          {account && (
            <div className="mobile-balances" onClick={() => handleNav(onOpenCashier)}>
              <div className="mobile-balances-title">Balances</div>
              <div className="mobile-balances-rows">
                <div className="mobile-bal-row">
                  <span>{xtzSym}</span>
                  <b>{xtzText}</b>
                </div>
                <div className="mobile-bal-row">
                  <span>{usdcSym}</span>
                  <b>{usdcText}</b>
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