// src/layouts/MainLayout.tsx
import { type ReactNode, useCallback, useMemo } from "react";
import { TopNav } from "../components/TopNav";
import { Footer } from "../components/Footer";
import "./MainLayout.css";

// Backgrounds
import bg1 from "../assets/backgrounds/bg1.webp";
import bg2 from "../assets/backgrounds/bg2.webp";
import bg3 from "../assets/backgrounds/bg3.webp";

const BACKGROUNDS = [bg1, bg2, bg3];

type Page = "home" | "explore" | "dashboard" | "about" | "faq";

type Props = {
  children: ReactNode;
  page: Page;
  onNavigate: (page: Page) => void;
  account: string | null;
  onOpenSignIn: () => void;
  onOpenCreate: () => void;
  onOpenCashier: () => void;
  onSignOut: () => void;
  hideChrome?: boolean;
};

// ==============================
// ✅ Phase 4: Lazy chunk preloads
// ==============================
const preload = {
  // pages
  explore: () => import("../pages/ExplorePage"),
  dashboard: () => import("../pages/DashboardPage"),
  about: () => import("../pages/AboutPage"),
  faq: () => import("../pages/FaqPage"),

  // modals
  signin: () => import("../components/SignInModal"),
  create: () => import("../components/CreateLotteryModal"),
  cashier: () => import("../components/CashierModal"),
};

function safeWarm(fn?: (() => Promise<any>) | null) {
  try {
    if (fn) void fn();
  } catch {
    // ignore
  }
}

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

  // Warm commonly used chunks early (hover/focus/touch intent)
  const warmExplore = useCallback(() => safeWarm(preload.explore), []);
  const warmDashboard = useCallback(() => safeWarm(preload.dashboard), []);
  const warmAbout = useCallback(() => safeWarm(preload.about), []);
  const warmFaq = useCallback(() => safeWarm(preload.faq), []);

  const warmSignIn = useCallback(() => safeWarm(preload.signin), []);
  const warmCreate = useCallback(() => safeWarm(preload.create), []);
  const warmCashier = useCallback(() => safeWarm(preload.cashier), []);

  // Wrap opens with a warm-up (still instant even if already loaded)
  const openSignIn = useCallback(() => {
    warmSignIn();
    onOpenSignIn();
  }, [warmSignIn, onOpenSignIn]);

  const openCreate = useCallback(() => {
    warmCreate();
    onOpenCreate();
  }, [warmCreate, onOpenCreate]);

  const openCashier = useCallback(() => {
    warmCashier();
    onOpenCashier();
  }, [warmCashier, onOpenCashier]);

  // Warm target page before navigation
  const nav = useCallback(
    (next: Page) => {
      if (next === "explore") warmExplore();
      if (next === "dashboard") warmDashboard();
      if (next === "about") warmAbout();
      if (next === "faq") warmFaq();
      onNavigate(next);
    },
    [onNavigate, warmExplore, warmDashboard, warmAbout, warmFaq]
  );

  // Helper: attach to hover/focus/touch intent
  const intentProps = (warm: () => void) => ({
    onMouseEnter: warm,
    onFocus: warm,
    onTouchStart: warm,
  });

  return (
    <div className="layout-shell">
      {/* 1. Global Background */}
      <div className="layout-bg" style={{ backgroundImage: `url(${chosenBg})` }} />
      <div className="layout-overlay" />

      {/* 2. Navigation (hidden when modal open) */}
      {!hideChrome && (
        <TopNav
          page={page as any}
          account={account}
          onNavigate={nav as any}
          onOpenExplore={() => nav("explore")}
          onOpenDashboard={() => nav("dashboard")}
          onOpenCreate={openCreate}
          onOpenCashier={openCashier}
          onOpenSignIn={openSignIn}
          onSignOut={onSignOut}
          // ✅ Phase 4: intent prefetch hooks (TopNav can ignore if it doesn't pass them through)
          // If your TopNav doesn't accept these props yet, add them there (recommended).
          {...intentProps(() => {
            // warm the most common "next" actions people do from nav
            warmExplore();
            warmDashboard();
            warmSignIn();
          })}
        />
      )}

      {/* 3. Page Content */}
      <main className="layout-content">{children}</main>

      {/* 4. Footer (hidden when modal open) */}
      {!hideChrome && (
        <div
          // ✅ Warm the “info pages” when users move toward the footer
          {...intentProps(() => {
            warmAbout();
            warmFaq();
          })}
        >
          <Footer onNavigate={nav as any} />
        </div>
      )}
    </div>
  );
}