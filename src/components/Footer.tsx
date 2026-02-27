// src/components/Footer.tsx
import "./Footer.css";
import ppopgiLogo from "/ppopgi-logo.png";
import { LINKS } from "../config/transparency";

type Page = "home" | "explore" | "dashboard" | "about" | "faq";

type Props = {
  onNavigate: (page: Page) => void;
};

export function Footer({ onNavigate }: Props) {
  const currentYear = new Date().getFullYear();

  const goAbout = () => {
    onNavigate("about");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goFaq = () => {
    onNavigate("faq");
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

  const hasAnyRepoLink = !!(LINKS.repoFrontend || LINKS.repoContracts || LINKS.repoFinalizerBot);

  return (
    <footer className="footer-container">
      <div className="footer-content">
        {/* LEFT: Branding & Copyright */}
        <div className="footer-brand">
          <div className="footer-logo-row">
            <img src={ppopgiLogo} alt="Ppopgi logo" className="footer-logo-img" />
            <span className="footer-logo-text">Ppopgi</span>
          </div>

          <div className="footer-desc">Fair, verifiable, on-chain lotteries.</div>
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

            {!hasAnyRepoLink ? (
              <span style={{ fontSize: 13, color: "#64748b" }}>Links coming soon</span>
            ) : (
              <>
                {LINKS.repoFrontend ? (
                  <a href={LINKS.repoFrontend} target="_blank" rel="noreferrer">
                    Frontend Code ↗
                  </a>
                ) : null}

                {LINKS.repoContracts ? (
                  <a href={LINKS.repoContracts} target="_blank" rel="noreferrer">
                    Smart Contracts ↗
                  </a>
                ) : null}

                {LINKS.repoFinalizerBot ? (
                  <a href={LINKS.repoFinalizerBot} target="_blank" rel="noreferrer">
                    Finalizer Bot ↗
                  </a>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}