// src/pages/AboutPage.tsx
import "./AboutPage.css";

export function AboutPage() {
  return (
    <div className="about-container">
      <div className="about-card">
        {/* Header */}
        <div className="about-header">
          <div className="about-icon">✍️</div>
          <h1 className="about-title">A Personal Note</h1>
          <div className="about-subtitle">From Ppopgi (뽑기)'s creator</div>
        </div>

        <div className="about-content">
          <p>
            <strong>Hi — I’m Julien. I’m an IT Infrastructure Engineer and a lifelong technology enthusiast.</strong>
          </p>

          <p>
            I’m naturally curious and detail-oriented — I love learning how systems work, where they break, and how to make them
            simpler, safer, and more reliable. Most of my career has been around infrastructure, networks, security, and designing
            solutions that need to be understandable and resilient. I’m also the kind of person who doesn’t mind starting from scratch
            if it means learning a new technology properly — even if I look a bit clueless at first.
          </p>

          <h3>The Journey</h3>
          <p>
            I’ve been around Tezos since the early days. I was even a Tezos baker back then (Neokta Labs) — not because I was chasing profits, but
            because I genuinely believed in the technology. Transparency, on-chain governance, and verifiable systems always mattered
            more to me than hype or quick wins.
          </p>
          <p>
            For a long time, I had this idea in my head: <em>“One day, I’ll build my own smart contracts and a real dApp.”</em>
            <br />
            But honestly, learning everything from zero while working full-time felt overwhelming. The ecosystem was powerful, but the
            learning curve was steep, and I didn’t want to rush something I didn’t fully understand.
          </p>

          <h3>The Catalyst: AI & Etherlink</h3>
          <p>
            Then AI arrived — and it changed everything for me. Suddenly, I didn’t feel alone when coding anymore. It felt like a
            coding buddy: not something that magically builds things for me, but something that helps me think, explore ideas,
            understand trade-offs, and move forward faster. AI made learning feel possible again. It unlocked doors I had been staring
            at for years.
          </p>
          <p>
            Around the same time, Etherlink launched — and that was another big moment. Etherlink combines values I appreciate from
            Tezos with the practicality and tooling of the EVM world. For someone with my background, it made experimentation feel
            faster and more approachable without sacrificing transparency or principles.
          </p>

          <div className="about-highlight-box">
            <h3>That’s how Ppopgi was born.</h3>
            <p>
              Ppopgi (뽑기) means “drawing” or “picking something at random” in Korean — like small festival games or capsule machines.
              That feeling is intentional. I wanted this to feel playful and fair — not like a casino, not like a financial product,
              and definitely not like something deceptive.
            </p>
          </div>

          <h3>Transparency by Design</h3>
          <p>
            Ppopgi is built so the most important parts are verifiable on-chain:{" "}
            <strong>the lottery rules, funds custody, and winner selection</strong>. The UI, indexing, and automation are there to make
            things fast and easy — but they don’t decide who wins.
          </p>

          <p>
            Each lottery is its own smart contract. That means lottery settings are fixed inside that contract, and funds are isolated
            per lottery. Payouts are handled through a “claim” flow (pull-based), so users claim what they’re owed directly from their
            wallet.
          </p>

          <p>
            I built Ppopgi in my spare time, funded it myself, and learned a lot along the way. It’s still experimental. It’s not
            perfect. And it’s very much a work in progress. But it’s built with care, respect for users, and a strong focus on
            transparency.
          </p>

          <p>
            Because the project is self-funded, there are protocol fees. They’re defined on-chain and fixed per lottery once it’s
            created. They’re clearly displayed in the app and verifiable on-chain. The goal is simply to cover infrastructure,
            maintenance, and keep the project independent.
          </p>

          <h3>A Note on Safety & Risk</h3>
          <p>
            I take safety seriously, but I also want to be straightforward: smart contracts can have bugs, integrations can fail, and
            blockchains have their own risks.{" "}
            <strong>Please interact thoughtfully and only with amounts you’re comfortable with.</strong>
          </p>
          <p>
            Every part of this project — smart contracts, frontend, automation, tests — was built with the help of AI. I acted as the
            designer, integrator, reviewer, and decision-maker. If you’re curious, you can inspect contract addresses and source
            verification via the Transparency links in the footer.
          </p>

          <hr className="about-divider" />

          <p>
            I didn’t build Ppopgi to chase trends or money. I built it because I love learning, building, and experimenting with
            transparent systems. AI made that journey possible in a way it wasn’t before, and Etherlink gave me the right playground
            to do it.
          </p>
          <p>
            If you find bugs, weird behavior, or have ideas — feedback is always welcome. This project grows through curiosity, not
            perfection.
          </p>

          <p>
            If you’d like to learn more about how Ppopgi works, its security model, and the underlying architecture, feel free to
            explore the{" "}
            <a href="?page=faq" className="rdm-info-link">
              FAQ
            </a>
            .
          </p>

          <div className="about-signoff">— Julien</div>
        </div>
      </div>
    </div>
  );
}