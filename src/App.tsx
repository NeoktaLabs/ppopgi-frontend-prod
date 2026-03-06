// src/App.tsx
import { useEffect, useMemo, useState, useCallback, useRef, lazy, Suspense } from "react";
import { useAutoConnect, useActiveAccount, useActiveWallet, useDisconnect } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { thirdwebClient } from "./thirdweb/client";
import { ETHERLINK_CHAIN } from "./thirdweb/etherlink";

// --- Layouts & Pages ---
import { MainLayout } from "./layouts/MainLayout";
import { HomePage } from "./pages/HomePage";
import { ExplorePage } from "./pages/ExplorePage";

// ✅ Keep SignIn + Disclaimer eager (small + frequently needed)
import { SignInModal } from "./components/SignInModal";
import { DisclaimerGate } from "./components/DisclaimerGate";

// ✅ global sync refresher
import { GlobalDataRefresher } from "./components/GlobalDataRefresher";

// ✅ notifications
import { NotificationCenter } from "./components/NotificationCenter";

// --- Hooks / State ---
import { useSession } from "./state/useSession";
import { useAppRouting } from "./hooks/useAppRouting";
import { useLotteryDetails } from "./hooks/useLotteryDetails";
import { useLotteryStore } from "./hooks/useLotteryStore";

// ==============================
// ✅ Lazy-loaded pages (non-critical on first paint)
// ==============================
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const AboutPage = lazy(() => import("./pages/AboutPage").then((m) => ({ default: m.AboutPage })));
const FaqPage = lazy(() => import("./pages/FaqPage").then((m) => ({ default: m.FaqPage })));
const StatusPage = lazy(() => import("./pages/StatusPage").then((m) => ({ default: m.StatusPage })));

// ==============================
// ✅ Lazy-loaded modals (heavy / not needed immediately)
// ==============================
const CreateLotteryModal = lazy(() =>
  import("./components/CreateLotteryModal").then((m) => ({ default: m.CreateLotteryModal }))
);
const LotteryDetailsModal = lazy(() =>
  import("./components/LotteryDetailsModal").then((m) => ({ default: m.LotteryDetailsModal }))
);
const CashierModal = lazy(() => import("./components/CashierModal").then((m) => ({ default: m.CashierModal })));
const SafetyProofModal = lazy(() => import("./components/SafetyProofModal").then((m) => ({ default: m.SafetyProofModal })));

// ✅ Tiny helper: best-effort preload on hover/click (keeps “instant” feel)
const preload = {
  dashboard: () => import("./pages/DashboardPage"),
  about: () => import("./pages/AboutPage"),
  faq: () => import("./pages/FaqPage"),
  status: () => import("./pages/StatusPage"),
  create: () => import("./components/CreateLotteryModal"),
  details: () => import("./components/LotteryDetailsModal"),
  cashier: () => import("./components/CashierModal"),
  safety: () => import("./components/SafetyProofModal"),
};

type Page = "home" | "explore" | "dashboard" | "about" | "faq" | "status";

function isValidPage(p: any): p is Page {
  return p === "home" || p === "explore" || p === "dashboard" || p === "about" || p === "faq" || p === "status";
}

function getPageFromUrl(): Page {
  try {
    const u = new URL(window.location.href);
    const p = (u.searchParams.get("page") || "").toLowerCase();
    return isValidPage(p) ? p : "home";
  } catch {
    return "home";
  }
}

function setPageInUrl(next: Page) {
  const u = new URL(window.location.href);

  if (!next || next === "home") u.searchParams.delete("page");
  else u.searchParams.set("page", next);

  // ✅ preserve everything else (including ?lottery=...)
  window.history.pushState({}, "", u.toString());
}

export default function App() {
  // --- Phase 0: baseline perf marks (app mounted) ---
  useEffect(() => {
    try {
      performance.mark("ppopgi:app_mounted");
      if (performance.getEntriesByName("ppopgi:boot_start").length > 0) {
        performance.measure("ppopgi:boot_to_app_mounted", "ppopgi:boot_start", "ppopgi:app_mounted");
      }
    } catch {
      // ignore
    }
  }, []);

  // 1) Thirdweb
  useAutoConnect({
    client: thirdwebClient,
    chain: ETHERLINK_CHAIN,
    wallets: [createWallet("io.metamask")],
  });

  // 2) Global session
  const activeAccount = useActiveAccount();
  const account = activeAccount?.address ?? null;
  const setSession = useSession((s) => s.set);
  const { disconnect } = useDisconnect();
  const activeWallet = useActiveWallet();

  // 3) Routing (page + lottery deep-link)
  const [page, setPage] = useState<Page>(() => (typeof window !== "undefined" ? getPageFromUrl() : "home"));
  const { selectedLotteryId, openLottery, closeLottery } = useAppRouting();

  // ✅ store (same items used by cards)
  const store = useLotteryStore("app-modal", 20_000);

  const selectedFromStore = useMemo(() => {
    const id = (selectedLotteryId || "").toLowerCase();
    if (!id) return null;
    return (store.items || []).find((r: any) => String(r.id || "").toLowerCase() === id) ?? null;
  }, [store.items, selectedLotteryId]);

  // 4) Modal states
  const [signInOpen, setSignInOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [cashierOpen, setCashierOpen] = useState(false);

  const openSignIn = useCallback(() => setSignInOpen(true), []);

  // 5) Disclaimer gate — show by default on first load
  const [showGate, setShowGate] = useState(false);
  useEffect(() => {
    const hasAccepted = localStorage.getItem("ppopgi_terms_accepted") === "true";
    setShowGate(!hasAccepted);
  }, []);

  const handleAcceptGate = () => {
    localStorage.setItem("ppopgi_terms_accepted", "true");
    setShowGate(false);
  };

  // Actions
  const handleSignOut = () => {
    if (activeWallet) disconnect(activeWallet);
  };

  // Safety modal
  const [safetyId, setSafetyId] = useState<string | null>(null);

  const handleOpenSafety = (id: string) => {
    try {
      void preload.safety();
    } catch {}
    closeLottery();
    setSafetyId(id);
  };

  // ✅ Lottery details for safety modal
  const { data: safetyData } = useLotteryDetails(safetyId, !!safetyId);

  // ✅ Hide layout chrome when any modal/gate is open
  const anyModalOpen = showGate || signInOpen || createOpen || cashierOpen || !!selectedLotteryId || !!safetyId;

  // ✅ prevent background scroll while a modal is open
  useEffect(() => {
    document.body.style.overflow = anyModalOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [anyModalOpen]);

  const navigateTo = useCallback(
    (next: Page) => {
      if (next === "dashboard" && !account) {
        setPage("home");
        setPageInUrl("home");
        openSignIn();
        return;
      }

      try {
        if (next === "dashboard") void preload.dashboard();
        if (next === "about") void preload.about();
        if (next === "faq") void preload.faq();
        if (next === "status") void preload.status();
      } catch {}

      setPage(next);
      setPageInUrl(next);
    },
    [account, openSignIn]
  );

  // Sync page from URL on back/forward
  const didInitRef = useRef(false);
  useEffect(() => {
    const applyFromUrl = () => {
      const next = getPageFromUrl();

      if (next === "dashboard" && !account) {
        setPage("home");
        setPageInUrl("home");
        openSignIn();
        return;
      }

      setPage(next);
    };

    if (!didInitRef.current) {
      didInitRef.current = true;
      applyFromUrl();
    }

    window.addEventListener("popstate", applyFromUrl);
    return () => window.removeEventListener("popstate", applyFromUrl);
  }, [account, openSignIn]);

  // Session sync
  useEffect(() => {
    setSession({ account, connector: account ? "thirdweb" : null });

    if (page === "dashboard" && !account) {
      setPage("home");
      setPageInUrl("home");
    }
  }, [account, page, setSession]);

  // Global events
  useEffect(() => {
    const onOpenCashier = () => {
      if (account) {
        try {
          void preload.cashier();
        } catch {}
        setCashierOpen(true);
      } else openSignIn();
    };

    const onOpenSignIn = () => {
      openSignIn();
    };

    const onNavigate = (e: Event) => {
      const ce = e as CustomEvent<{ page?: Page }>;
      const next = ce?.detail?.page;
      if (!next || !isValidPage(next)) return;
      navigateTo(next);
    };

    window.addEventListener("ppopgi:open-cashier", onOpenCashier);
    window.addEventListener("ppopgi:open-signin", onOpenSignIn);
    window.addEventListener("ppopgi:navigate", onNavigate as EventListener);

    return () => {
      window.removeEventListener("ppopgi:open-cashier", onOpenCashier);
      window.removeEventListener("ppopgi:open-signin", onOpenSignIn);
      window.removeEventListener("ppopgi:navigate", onNavigate as EventListener);
    };
  }, [account, navigateTo, openSignIn]);

  return (
    <>
      <GlobalDataRefresher intervalMs={15000} />
      <NotificationCenter />
      <DisclaimerGate open={showGate} onAccept={handleAcceptGate} />

      <MainLayout
        page={page}
        onNavigate={navigateTo}
        account={account}
        onOpenSignIn={openSignIn}
        onOpenCreate={() => {
          if (!account) return openSignIn();
          try {
            void preload.create();
          } catch {}
          setCreateOpen(true);
        }}
        onOpenCashier={() => {
          if (!account) return openSignIn();
          try {
            void preload.cashier();
          } catch {}
          setCashierOpen(true);
        }}
        onSignOut={handleSignOut}
        hideChrome={anyModalOpen}
      >
        {page === "home" && <HomePage onOpenLottery={openLottery} onOpenSafety={handleOpenSafety} />}
        {page === "explore" && <ExplorePage onOpenLottery={openLottery} onOpenSafety={handleOpenSafety} />}

        {page === "dashboard" && (
          <Suspense fallback={null}>
            <DashboardPage account={account} onOpenLottery={openLottery} onOpenSafety={handleOpenSafety} />
          </Suspense>
        )}

        {page === "about" && (
          <Suspense fallback={null}>
            <AboutPage />
          </Suspense>
        )}

        {page === "faq" && (
          <Suspense fallback={null}>
            <FaqPage />
          </Suspense>
        )}

        {page === "status" && (
          <Suspense fallback={null}>
            <StatusPage />
          </Suspense>
        )}

        {/* --- Modals --- */}
        <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />

        <Suspense fallback={null}>
          <CreateLotteryModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => {}} />
        </Suspense>

        <Suspense fallback={null}>
          <CashierModal open={cashierOpen} onClose={() => setCashierOpen(false)} />
        </Suspense>

        <Suspense fallback={null}>
          <LotteryDetailsModal
            open={!!selectedLotteryId}
            lotteryId={selectedLotteryId}
            onClose={closeLottery}
            initialLottery={selectedFromStore as any}
            onOpenSignIn={openSignIn}
          />
        </Suspense>

        {safetyId && safetyData && (
          <Suspense fallback={null}>
            <SafetyProofModal open={!!safetyId} onClose={() => setSafetyId(null)} lottery={safetyData as any} />
          </Suspense>
        )}
      </MainLayout>
    </>
  );
}