// src/components/Footer.tsx
import "./Footer.css";
import ppopgiLogo from "/ppopgi-logo.png";

type Page = "home" | "explore" | "dashboard" | "about" | "faq"; // ✅ add faq

type Props = {
  onNavigate: (page: Page) => void;
};

export function Footer({ onNavigate }: Props) {
  const currentYear = new Date().getFullYear();

  const goAbout = () => {
    onNavigate("about");
    // ✅ Important: users are at the bottom when clicking footer → scroll up to actually see About
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goFaq = () => {
    onNavigate("faq");
    // ✅ Same behavior for FAQ
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const linkBtnStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: 0,
    color: "#334155",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
  };

  return (
    <footer className="footer-container">
      <div className="footer-content">
        {/* LEFT: Branding & Copyright */}
        <div className="footer-brand">
          <div className="footer-logo-row">
            <img src={ppopgiLogo} alt="Ppopgi logo" className="footer-logo-img" />
            <span className="footer-logo-text">Ppopgi</span>
          </div>

          <div className="footer-desc">Fair, verifiable, on-chain raffles.</div>

          <div className="footer-built">Built with love on Etherlink 💚</div>

          <div className="footer-copy">&copy; {currentYear} Ppopgi. With love.</div>
        </div>

        {/* RIGHT: Links Grid */}
        <div className="footer-links">
          {/* Project */}
          <div className="footer-col">
            <h4>Project</h4>

            <button
              type="button"
              onClick={goAbout}
              style={linkBtnStyle}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#2563eb")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#334155")}
            >
              About &amp; Founder's Note
            </button>

            {/* ✅ NEW FAQ LINK */}
            <button
              type="button"
              onClick={goFaq}
              style={{ ...linkBtnStyle, marginTop: 10 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#2563eb")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#334155")}
            >
              FAQ
            </button>
          </div>

          {/* Transparency */}
          <div className="footer-col">
            <h4>Transparency</h4>

            <a href="https://github.com/NeoktaLabs/ppopgi-frontend-dev" target="_blank" rel="noreferrer">
              Frontend Code ↗
            </a>

            <a href="https://github.com/NeoktaLabs/ppopgi-smartcontracts" target="_blank" rel="noreferrer">
              Smart Contracts ↗
            </a>

            <a href="https://github.com/NeoktaLabs/ppopgi-finalizerbot" target="_blank" rel="noreferrer">
              Finalizer Bot ↗
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}