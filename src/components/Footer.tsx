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
              className="footer-link-btn"
            >
              About &amp; Founder's Note
            </button>

            <button
              type="button"
              onClick={goFaq}
              className="footer-link-btn"
            >
              FAQ
            </button>
          </div>

          {/* Community (NEW) */}
          <div className="footer-col">
            <h4>Community</h4>

            <a href="https://x.com/ppopgixyz?s=21" target="_blank" rel="noreferrer" className="footer-link-btn">
              𝕏 Follow on X
            </a>

            <a href="mailto:hi@ppopgi.xyz" className="footer-link-btn">
              💌 hi@ppopgi.xyz
            </a>
          </div>

          {/* Transparency */}
          <div className="footer-col">
            <h4>Transparency</h4>

            {!hasAnyRepoLink ? (
              <span className="footer-link-disabled">Links coming soon</span>
            ) : (
              <>
                {LINKS.repoFrontend ? (
                  <a href={LINKS.repoFrontend} target="_blank" rel="noreferrer" className="footer-link-btn">
                    Frontend Code ↗
                  </a>
                ) : null}

                {LINKS.repoContracts ? (
                  <a href={LINKS.repoContracts} target="_blank" rel="noreferrer" className="footer-link-btn">
                    Smart Contracts ↗
                  </a>
                ) : null}

                {LINKS.repoFinalizerBot ? (
                  <a href={LINKS.repoFinalizerBot} target="_blank" rel="noreferrer" className="footer-link-btn">
                    Finalizer Bot ↗
                  </a>
                ) : null}
              </>
            )}
          </div>
          
          {/* SolidityScan */}
          <div className="footer-col">
            <h4>Audit (SolidityScan)</h4>

            {!hasAnyRepoLink ? (
              <span className="footer-link-disabled">Links coming soon</span>
            ) : (
              <>
                {LINKS.repoFrontend ? (
                  <a href={LINKS.solidityScanRegistry} target="_blank" rel="noreferrer" className="footer-link-btn">
                    Ppopgi Registry Contract ↗
                  </a>
                ) : null}

                {LINKS.repoContracts ? (
                  <a href={LINKS.solidityScanDeployer} target="_blank" rel="noreferrer" className="footer-link-btn">
                    Ppopgi Lottery Contract ↗
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
