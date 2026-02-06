// src/layouts/MainLayout.tsx
import { type ReactNode, useMemo } from "react"; // ✅ Fixed imports
import { TopNav } from "../components/TopNav";
// import { Toast } from "../components/Toast"; // ✅ Commented out Toast (requires props)
import { Footer } from "../components/Footer";
import "./MainLayout.css";

// Import your backgrounds
import bg1 from "../assets/backgrounds/bg1.webp";
import bg2 from "../assets/backgrounds/bg2.webp";
import bg3 from "../assets/backgrounds/bg3.webp";

const BACKGROUNDS = [bg1, bg2, bg3];

type Props = {
  children: ReactNode;
  page: "home" | "explore" | "dashboard";
  onNavigate: (page: "home" | "explore" | "dashboard") => void;
  account: string | null;
  onOpenSignIn: () => void;
  onOpenCreate: () => void;
  onOpenCashier: () => void;
  onSignOut: () => void;
};

export function MainLayout({ 
  children, 
  page, 
  onNavigate, 
  account, 
  onOpenSignIn, 
  onOpenCreate, 
  onOpenCashier, 
  onSignOut 
}: Props) {
  
  // Pick a random background once on mount
  const chosenBg = useMemo(() => BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)], []);

  return (
    <div className="layout-shell">
      {/* 1. Global Background */}
      <div 
        className="layout-bg" 
        style={{ backgroundImage: `url(${chosenBg})` }} 
      />
      <div className="layout-overlay" />

      {/* 2. Global Gates & Modals */}
      {/* <Toast /> */} {/* ✅ Commented out until it has proper props */}

      {/* 3. Navigation */}
      <TopNav 
        page={page}
        account={account}
        onNavigate={(p) => onNavigate(p as any)}
        onOpenExplore={() => onNavigate("explore")}
        onOpenDashboard={() => onNavigate("dashboard")}
        onOpenCreate={onOpenCreate}
        onOpenCashier={onOpenCashier}
        onOpenSignIn={onOpenSignIn}
        onSignOut={onSignOut}
      />

      {/* 4. Page Content */}
      <main className="layout-content">
        {children}
      </main>

      {/* 5. Footer */}
      <Footer />
    </div>
  );
}
