// src/components/TopNav.tsx
import { useState, useEffect, memo } from "react";
import "./TopNav.css";

type Page = "home" | "explore" | "dashboard";

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

  // Close menu when changing PAGE
  useEffect(() => {
    setMenuOpen(false);
  }, [page]);

  const closeMenu = () => setMenuOpen(false);

  // Wrapper for actions (optionally also navigates)
  const handleNav = (action: () => void, targetPage?: Page) => {
    if (targetPage) onNavigate(targetPage);
    action();
    closeMenu();
  };

  return (
    <div className="topnav-wrapper">
      <div className="topnav-pill">
        {/* --- LEFT: Brand --- */}
        <div className="topnav-brand" onClick={() => handleNav(() => {}, "home")}>
          {/* ✅ Logo + Text */}
          <img
            className="topnav-logo"
            src="/ppopgi-logo.png"
            alt="Ppopgi logo"
            draggable={false}
          />
          <span className="brand-text">Ppopgi</span>
        </div>

        {/* --- CENTER: Desktop Links --- */}
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

        {/* --- RIGHT: Account & Mobile Toggle --- */}
        <div className="topnav-right">
          {/* Desktop Only Actions */}
          <div className="desktop-actions">
            <button
              className="nav-link cashier-btn"
              onClick={() => handleNav(onOpenCashier)}
              title="Open Cashier"
            >
              🏦 Cashier
            </button>

            {!account ? (
              <button className="nav-link signin-btn" onClick={() => handleNav(onOpenSignIn)}>
                Sign In
              </button>
            ) : (
              <div
                className="account-badge"
                onClick={() => handleNav(onSignOut)}
                title="Click to Sign Out"
              >
                <div className="acct-dot" />
                {short(account)}
              </div>
            )}
          </div>

          {/* Mobile Toggle */}
          <button
            className={`mobile-burger ${menuOpen ? "open" : ""}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <span />
            <span />
          </button>
        </div>
      </div>

      {/* --- MOBILE DROPDOWN --- */}
      <div className={`mobile-menu ${menuOpen ? "visible" : ""}`}>
        <div className="mobile-menu-inner">
          <button onClick={() => handleNav(onOpenExplore, "explore")}>🌍 Explore</button>

          {account && <button onClick={() => handleNav(onOpenDashboard, "dashboard")}>👤 Dashboard</button>}

          <button className="highlight" onClick={() => handleNav(onOpenCreate)}>
            ✨ Create Raffle
          </button>

          <div className="mobile-divider" />

          {/* ✅ close menu on Cashier / Sign-in too */}
          <button onClick={() => handleNav(onOpenCashier)}>🏦 Cashier</button>

          {!account ? (
            <button className="primary" onClick={() => handleNav(onOpenSignIn)}>
              Sign In
            </button>
          ) : (
            <button className="danger" onClick={() => handleNav(onSignOut)}>
              Sign Out ({short(account)})
            </button>
          )}
        </div>
      </div>

      {/* Overlay to close menu when clicking outside */}
      {menuOpen && <div className="mobile-overlay" onMouseDown={closeMenu} />}
    </div>
  );
});