// src/layouts/MainLayout.tsx
import { type ReactNode, useMemo } from "react";
import { TopNav } from "../components/TopNav";
import { Footer } from "../components/Footer";
import "./MainLayout.css";

// Backgrounds
import bg1 from "../assets/backgrounds/bg1.webp";
import bg2 from "../assets/backgrounds/bg2.webp";
import bg3 from "../assets/backgrounds/bg3.webp";

const BACKGROUNDS = [bg1, bg2, bg3];

type Page = "home" | "explore" | "dashboard" | "about" | "faq"; // ✅ add faq

type Props = {
  children: ReactNode;
  page: Page;
  onNavigate: (page: Page) => void;
  account: string | null;
  onOpenSignIn: () => void;
  onOpenCreate: () => void;
  onOpenCashier: () => void;
  onSignOut: () => void;

  // ✅ NEW: hide TopNav/Footer when a modal is open
  hideChrome?: boolean;
};

export function MainLayout({
  children,
  page,
  onNavigate,
  account,
  onOpenSignIn,
  onOpenCreate,
  onOpenCashier,
  onSignOut,
  hideChrome = false,
}: Props) {
  // Pick a random background once on mount
  const chosenBg = useMemo(() => BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)], []);

  return (
    <div className="layout-shell">
      {/* 1. Global Background */}
      <div className="layout-bg" style={{ backgroundImage: `url(${chosenBg})` }} />
      <div className="layout-overlay" />

      {/* 2. Navigation (hidden when modal open) */}
      {!hideChrome && (
        <TopNav
          page={page as any} // TopNav doesn't include "faq/about" in its Page union, so keep safe cast
          account={account}
          onNavigate={onNavigate as any}
          onOpenExplore={() => onNavigate("explore")}
          onOpenDashboard={() => onNavigate("dashboard")}
          onOpenCreate={onOpenCreate}
          onOpenCashier={onOpenCashier}
          onOpenSignIn={onOpenSignIn}
          onSignOut={onSignOut}
        />
      )}

      {/* 3. Page Content */}
      <main className="layout-content">{children}</main>

      {/* 4. Footer (hidden when modal open) */}
      {!hideChrome && <Footer onNavigate={onNavigate} />}
    </div>
  );
}