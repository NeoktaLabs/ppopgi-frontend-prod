// src/App.tsx
import { useEffect, useState } from "react";
import { useAutoConnect, useActiveAccount, useActiveWallet, useDisconnect } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { thirdwebClient } from "./thirdweb/client";
import { ETHERLINK_CHAIN } from "./thirdweb/etherlink";

// --- Layouts & Pages ---
import { MainLayout } from "./layouts/MainLayout";
import { HomePage } from "./pages/HomePage";
import { ExplorePage } from "./pages/ExplorePage";
import { DashboardPage } from "./pages/DashboardPage";

// --- Components (Modals) ---
import { SignInModal } from "./components/SignInModal";
import { CreateRaffleModal } from "./components/CreateRaffleModal";
import { RaffleDetailsModal } from "./components/RaffleDetailsModal";
import { CashierModal } from "./components/CashierModal";
import { SafetyProofModal } from "./components/SafetyProofModal";
import { DisclaimerGate } from "./components/DisclaimerGate"; // ✅ IMPORTED

// --- Hooks ---
import { useSession } from "./state/useSession";
import { useAppRouting } from "./hooks/useAppRouting";
import { useRaffleDetails } from "./hooks/useRaffleDetails";

export default function App() {
  // 1. Thirdweb Config
  useAutoConnect({ client: thirdwebClient, chain: ETHERLINK_CHAIN, wallets: [createWallet("io.metamask")] });
  
  // 2. Global State
  const activeAccount = useActiveAccount();
  const account = activeAccount?.address ?? null;
  const setSession = useSession((s) => s.set);
  const { disconnect } = useDisconnect();
  const activeWallet = useActiveWallet();

  // 3. Routing & Navigation
  const [page, setPage] = useState<"home" | "explore" | "dashboard">("home");
  const { selectedRaffleId, openRaffle, closeRaffle } = useAppRouting();

  // 4. Modal States
  const [signInOpen, setSignInOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [cashierOpen, setCashierOpen] = useState(false);
  
  // ✅ GATE STATE
  const [showGate, setShowGate] = useState(false);
  
  // Safety Modal Logic
  const [safetyId, setSafetyId] = useState<string | null>(null);
  
  // 5. Global Clock (One tick for the whole app)
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(t); }, []);

  // ✅ CHECK DISCLAIMER STATUS ON LOAD
  useEffect(() => {
    const hasAccepted = localStorage.getItem("ppopgi_terms_accepted");
    if (!hasAccepted) {
      setShowGate(true);
    }
  }, []);

  const handleAcceptGate = () => {
    localStorage.setItem("ppopgi_terms_accepted", "true");
    setShowGate(false);
  };

  // Sync Session
  useEffect(() => {
    setSession({ account, connector: account ? "thirdweb" : null });
    if (page === "dashboard" && !account) setPage("home");
  }, [account, page, setSession]);

  // Actions
  const handleSignOut = () => { if (activeWallet) disconnect(activeWallet); };
  
  const handleOpenSafety = (id: string) => { 
    closeRaffle(); 
    setSafetyId(id); 
  };

  // Data for Safety Modal (Fetches only when ID is set)
  const { data: safetyData } = useRaffleDetails(safetyId, !!safetyId);

  return (
    <>
      {/* ✅ DISCLAIMER GATE (Highest Priority) */}
      <DisclaimerGate open={showGate} onAccept={handleAcceptGate} />

      <MainLayout
        page={page}
        onNavigate={setPage}
        account={account}
        onOpenSignIn={() => setSignInOpen(true)}
        onOpenCreate={() => account ? setCreateOpen(true) : setSignInOpen(true)}
        onOpenCashier={() => setCashierOpen(true)}
        onSignOut={handleSignOut}
      >
        {/* --- Page Routing --- */}
        {page === "home" && (
          <HomePage 
            nowMs={nowMs} 
            onOpenRaffle={openRaffle} 
            onOpenSafety={handleOpenSafety} 
          />
        )}
        
        {page === "explore" && (
          <ExplorePage 
            onOpenRaffle={openRaffle} 
            onOpenSafety={handleOpenSafety}
          />
        )}
        
        {page === "dashboard" && (
          <DashboardPage 
            account={account} 
            onOpenRaffle={openRaffle} 
            onOpenSafety={handleOpenSafety}
          />
        )}

        {/* --- Global Modals --- */}
        <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
        
        <CreateRaffleModal 
          open={createOpen} 
          onClose={() => setCreateOpen(false)} 
          onCreated={() => { /* Optional toast logic here */ }} 
        />
        
        <CashierModal open={cashierOpen} onClose={() => setCashierOpen(false)} />

        {/* Detail Modals */}
        <RaffleDetailsModal 
          open={!!selectedRaffleId} 
          raffleId={selectedRaffleId} 
          onClose={closeRaffle} 
        />

        {safetyId && safetyData && (
          <SafetyProofModal open={!!safetyId} onClose={() => setSafetyId(null)} raffle={safetyData} />
        )}

      </MainLayout>
    </>
  );
}
