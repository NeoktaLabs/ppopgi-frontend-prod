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
            <strong>Hi, My name is Julien, I am an IT engineer and a lifelong technology enthusiast.</strong>
          </p>

          <p>
            I’ve spent most of my career around systems, networks, security, and designing solutions that need to be reliable and understandable. I’ve always enjoyed figuring out how things work, how they fail, and how to make them simpler and safer. I’m also the kind of person who doesn’t mind starting from scratch again if it means learning something new — even if I look a bit clueless at first.
          </p>

          <h3>The Journey</h3>
          <p>
            I’ve been around Tezos since the early days. I was even a Tezos baker back then. Not because I was chasing profits, but because I genuinely believed in the technology. Transparency, on-chain governance, and verifiable systems always mattered more to me than hype or quick wins.
          </p>
          <p>
            For a long time, I had this idea in my head: <em>“One day, I’ll build my own smart contracts and a real dApp.”</em>
            <br />
            But honestly, learning everything from zero while working full-time felt overwhelming. The ecosystem was powerful, but the learning curve was steep, and I didn’t want to rush something I didn’t fully understand.
          </p>

          <h3>The Catalyst: AI & Etherlink</h3>
          <p>
            Then AI arrived — and it changed everything for me. Suddenly, I didn’t feel alone when coding anymore. I found something that felt like a coding buddy. Not something that magically builds things for me, but something that helps me think, explore ideas, understand trade-offs, and move forward faster. AI made learning feel possible again. It unlocked doors I had been staring at for years.
          </p>
          <p>
            Around the same time, Etherlink launched — and that was another big moment.
            Etherlink combines the values I appreciate from Tezos with the practicality and tooling of the EVM world. For someone with my background, it made experimentation feel safer, faster, and more approachable without sacrificing transparency or principles.
          </p>

          <div className="about-highlight-box">
            <h3>That’s how Ppopgi was born.</h3>
            <p>
              Ppopgi (뽑기) means “drawing” or “picking something at random” in Korean — like small festival games or capsule machines. That feeling is intentional. I wanted this to feel playful and fair, not like a casino, not like a financial product, and definitely not like something deceptive.
            </p>
          </div>

          <h3>Transparency by Design</h3>
          <p>
            This project is fully on-chain by design. No hidden logic. No off-chain winner selection. No fake activity or artificial urgency. What matters is visible, verifiable, and enforced by smart contracts.
          </p>
          <p>
            I built Ppopgi in my spare time, funded it myself, and learned a lot along the way. It’s still experimental. It’s not perfect. And it’s very much a work in progress. But it’s built with care, respect for users, and a strong focus on transparency.
          </p>
          <p>
            Because the project is self-funded, there are protocol fees. They’re defined on-chain, immutable per raffle, clearly displayed, and fully verifiable. No hidden costs, no surprises. The goal is simply to cover infrastructure, maintenance, and keep the project independent.
          </p>

          <h3>A Note on Risk</h3>
          <p>
            Every part of this project — smart contracts, frontend, automation, tests — was built with the help of AI. I acted as the designer, integrator, reviewer, and decision-maker. That also means I want to be honest: <strong>this is not risk-free or “enterprise-grade”. Please interact with it thoughtfully and only with amounts you’re comfortable with.</strong>
          </p>

          <hr className="about-divider" />

          <p>
            I didn’t build Ppopgi to chase trends or money. I built it because I love learning, building, and experimenting with transparent systems. AI made that journey possible in a way it wasn’t before, and Etherlink gave me the right playground to do it.
          </p>
          <p>
            If you find bugs, weird behavior, or have ideas — feedback is always welcome.
            This project grows through curiosity, not perfection.
          </p>

          <div className="about-signoff">
            — Julien
          </div>
        </div>
      </div>
    </div>
  );
}
