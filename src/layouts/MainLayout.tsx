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

type Page = "home" | "explore" | "dashboard" | "about" | "faq" | "status";

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
  status: () => import("../pages/StatusPage"),

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
  const chosenBg = useMemo(() => BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)], []);

  const warmExplore = useCallback(() => safeWarm(preload.explore), []);
  const warmDashboard = useCallback(() => safeWarm(preload.dashboard), []);
  const warmAbout = useCallback(() => safeWarm(preload.about), []);
  const warmFaq = useCallback(() => safeWarm(preload.faq), []);
  const warmStatus = useCallback(() => safeWarm(preload.status), []);

  const warmSignIn = useCallback(() => safeWarm(preload.signin), []);
  const warmCreate = useCallback(() => safeWarm(preload.create), []);
  const warmCashier = useCallback(() => safeWarm(preload.cashier), []);

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

  const nav = useCallback(
    (next: Page) => {
      if (next === "explore") warmExplore();
      if (next === "dashboard") warmDashboard();
      if (next === "about") warmAbout();
      if (next === "faq") warmFaq();
      if (next === "status") warmStatus();
      onNavigate(next);
    },
    [onNavigate, warmExplore, warmDashboard, warmAbout, warmFaq, warmStatus]
  );

  const intentProps = (warm: () => void) => ({
    onMouseEnter: warm,
    onFocus: warm,
    onTouchStart: warm,
  });

  return (
    <div className="layout-shell">
      <div className="layout-bg" style={{ backgroundImage: `url(${chosenBg})` }} />
      <div className="layout-overlay" />

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
          {...intentProps(() => {
            warmExplore();
            warmDashboard();
            warmSignIn();
          })}
        />
      )}

      <main className="layout-content">{children}</main>

      {!hideChrome && (
        <div
          {...intentProps(() => {
            warmAbout();
            warmFaq();
            warmStatus();
          })}
        >
          <Footer onNavigate={nav as any} />
        </div>
      )}
    </div>
  );
}