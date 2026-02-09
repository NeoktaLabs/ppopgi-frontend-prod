// src/pages/FaqPage.tsx
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import "./FaqPage.css";

import { MermaidDiagram } from "../components/MermaidDiagram";

type FaqItem = {
  id: string;
  q: string;
  a: ReactNode;
  tags?: string[];
};

// ✅ UPDATED: Mermaid Theme matches Brand (Pink/Crimson)
const RAFFLE_FLOW = `
%%{
  init: {
    'theme': 'base',
    'themeVariables': {
      'primaryColor': '#ffffff',
      'primaryTextColor': '#4A0F2B',
      'primaryBorderColor': '#fce7f3',
      'lineColor': '#be185d',
      'fontFamily': 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      'fontSize': '14px'
    },
    'flowchart': {
      'curve': 'basis',
      'nodeSpacing': 40,
      'rankSpacing': 60
    }
  }
}%%

flowchart TD
  classDef brand fill:#fdf2f8,stroke:#db2777,stroke-width:2px,color:#be185d,rx:12,ry:12;
  classDef decision fill:#ffffff,stroke:#9d174d,stroke-width:2px,color:#4A0F2B,rx:6,ry:6,stroke-dasharray: 5 5;
  classDef success fill:#f0fdf4,stroke:#16a34a,stroke-width:2px,color:#15803d,rx:12,ry:12;
  classDef fail fill:#fff1f2,stroke:#e11d48,stroke-width:2px,color:#9f1239,rx:12,ry:12;
  classDef tech fill:#fff,stroke:#4A0F2B,stroke-width:2px,color:#4A0F2B,rx:4,ry:4,stroke-dasharray: 2 2;

  A[Creator Launches]:::brand
  B[Prize Pot Funded]:::brand
  C[Raffle OPEN]:::brand

  D{Max Tickets?}:::decision
  E{Deadline?}:::decision
  F{Min Tickets?}:::decision

  Bot[Finalizer Bot<br/>runs ~every 5 min]:::tech
  User[Any User]:::tech

  H[Drawing Phase]:::tech
  I[Pyth Entropy<br/>Verifiable Randomness]:::tech

  J[Winner Selected]:::success
  G[Raffle Canceled]:::fail

  K[Winner Claims Prize]:::success
  L[Creator Claims Revenue]:::success
  M[Players Refund Tickets]:::fail
  N[Creator Reclaims Pot]:::fail

  A --> B --> C
  C --> D

  D -- No --> E
  E -- No --> C
  
  D -- Yes --> F
  E -- Yes --> F

  F -- No --> G
  G --> M & N

  F -- Yes --> H
  Bot -.-> H
  User -.-> H
  
  H --> I --> J
  J --> K & L

  linkStyle default stroke:#db2777,stroke-width:2px,fill:none;
`;

const FAQ_ITEMS: FaqItem[] = [
  {
    id: "what-is",
    q: "What is Ppopgi?",
    a: (
      <>
        Ppopgi is a friendly, on-chain raffle app on <b>Etherlink (Tezos L2, EVM)</b>.
        <br />
        <br />
        A typical raffle works like this:
        <ul className="faq-ul">
          <li>
            A <b>creator deposits a prize pot</b> (USDC) into the raffle contract.
          </li>
          <li>
            Players <b>buy tickets</b> (USDC) while the raffle is open.
          </li>
          <li>
            When the raffle ends (sold out or deadline), a <b>winner is selected on-chain</b> using verifiable randomness.
          </li>
          <li>
            After the draw, funds are handled as <b>claims</b>: the winner claims the prize (minus prize fee) and the creator claims
            ticket revenue (minus ticket fee).
          </li>
        </ul>
        <div className="faq-callout">
          Core idea: no hidden server logic deciding outcomes — the important rules are enforced by the raffle contract.
        </div>
      </>
    ),
  },

  {
    id: "randomness",
    q: "How does randomness work? Is it verifiable?",
    a: (
      <>
        Yes — the draw is verifiable and not “hidden” behind off-chain logic.
        <br />
        <br />
        Ppopgi uses <b>Pyth Entropy</b> as the randomness source. In plain terms:
        <ol className="faq-ol">
          <li>
            When a raffle is ready to settle (deadline reached or sold out), the raffle asks Pyth Entropy for a{" "}
            <b>random value tied to that exact raffle draw</b>.
          </li>
          <li>
            That randomness is returned <b>on-chain</b> and delivered back to the raffle contract.
          </li>
          <li>
            The raffle uses it to pick a winner deterministically by mapping the random number into the range of sold tickets
            (conceptually: <code>random % totalSold</code>).
          </li>
          <li>
            The winning ticket index is then matched to the owner using the on-chain ticket ownership history (ranges), and the result
            is written on-chain.
          </li>
        </ol>
        <div className="faq-callout">
          There is no private server picking the winner. Even the protocol owner cannot override the result — the contract only
          accepts randomness from the Pyth Entropy contract.
        </div>
      </>
    ),
  },

  {
    id: "finalize-fee",
    q: "Who settles a raffle, and who pays for randomness?",
    a: (
      <>
        Settling (finalizing) a raffle is <b>permissionless</b> — anyone can do it once the raffle is ready:
        <ul className="faq-ul">
          <li>either the raffle is <b>sold out</b> (max tickets reached),</li>
          <li>or the <b>deadline has passed</b>.</li>
        </ul>
        <br />
        Randomness has a small network cost because it uses an on-chain randomness provider. The person who triggers settlement pays
        that cost <b>at the moment the randomness request is made</b>.
        <br />
        <br />
        In practice this is usually:
        <ul className="faq-ul">
          <li>the creator,</li>
          <li>a player,</li>
          <li>or an automated helper (the <b>finalizer bot</b>).</li>
        </ul>
        <div className="faq-callout">
          This cost is separate from Ppopgi fees: it’s the network/randomness request cost paid upfront by whoever finalizes.
        </div>
      </>
    ),
  },

  {
    id: "finalizer-bot",
    q: "What is the finalizer bot?",
    a: (
      <>
        The finalizer bot is a simple automated helper that improves UX.
        <br />
        <br />
        It runs on a schedule (about <b>every ~5 minutes</b>) and checks for raffles that are ready to settle (deadline reached or
        sold out). If it finds one, it can trigger settlement so raffles don’t stay “waiting” forever.
        <br />
        <br />
        <div className="faq-callout">
          Important: the bot does not decide winners and cannot change outcomes — it only triggers the same public “settle” action that
          any user can call.
        </div>
      </>
    ),
  },

  {
    id: "stuck-drawing",
    q: "What if a raffle gets stuck while settling?",
    a: (
      <>
        Rarely, a raffle could get stuck during settlement (for example: a delayed randomness callback, temporary provider issues, or
        unusual network conditions).
        <br />
        <br />
        To protect users, the contracts include an <b>emergency recovery</b> path:
        <ul className="faq-ul">
          <li>
            After a <b>short delay</b>, the <b>creator</b> or the <b>protocol owner</b> can recover the raffle.
          </li>
          <li>
            After a <b>longer delay</b>, <b>anyone</b> can recover it (so it can’t remain stuck forever).
          </li>
        </ul>
        Recovery cancels the raffle and moves funds into the normal refund/claim flow.
        <div className="faq-callout">
          Goal: users should always have a path to get their funds back, even in edge cases.
        </div>
      </>
    ),
  },

  {
    id: "fees",
    q: "What are the fees? (Prize vs ticket sales)",
    a: (
      <>
        Fees are transparent and enforced by the raffle contract when the raffle completes:
        <ul className="faq-ul">
          <li>
            <b>10% on ticket sales</b> (taken from ticket revenue)
          </li>
          <li>
            <b>10% on the prize pot</b> (taken from the prize pot)
          </li>
        </ul>
        <div className="faq-callout">
          Example: Prize pot = 100 USDC → winner can claim 90 USDC. Ticket sales = 200 USDC → creator can claim 180 USDC.
          The remaining 10 + 20 USDC is allocated as protocol fees.
        </div>
        Fees are <b>not discretionary</b> once the raffle is live — they’re computed by the contract at settlement.
      </>
    ),
  },

  {
    id: "why-fees",
    q: "Why are there fees?",
    a: (
      <>
        Ppopgi is self-funded and runs real infrastructure. Fees exist to cover operating costs such as:
        <ul className="faq-ul">
          <li>hosting and app infrastructure,</li>
          <li>RPC usage and reliability costs,</li>
          <li>running the finalizer bot,</li>
          <li>indexing / data services,</li>
          <li>maintenance and improvements over time.</li>
        </ul>
        If the project grows, fees may also help fund <b>special community events</b> and themed raffles throughout the year.
      </>
    ),
  },

  {
    id: "fees-fixed",
    q: "Are fees fixed once a raffle is created?",
    a: (
      <>
        Yes — once a raffle is created, its fee settings are <b>fixed for that raffle</b>.
        <br />
        <br />
        The protocol may update defaults for <b>future</b> raffles, but existing raffles remain unchanged.
      </>
    ),
  },

  {
    id: "permissions",
    q: "Who can do what? (Owner vs creator vs players)",
    a: (
      <>
        Here’s the simple breakdown:
        <ul className="faq-ul">
          <li>
            <b>Players</b> can buy tickets and claim refunds/payouts when available.
          </li>
          <li>
            <b>Creators</b> choose raffle parameters, fund the prize pot, and can claim ticket revenue after settlement. Creators{" "}
            <b>cannot</b> buy tickets in their own raffle.
          </li>
          <li>
            <b>The protocol owner</b> (a Safe multisig) has limited admin powers like pausing in emergencies and updating allowed
            configuration for future raffles — but <b>cannot</b> change winners or rewrite outcomes once a raffle exists.
          </li>
        </ul>
        <div className="faq-callout">
          The protocol owner is a multisig. Today it contains 1 signer (me), with the goal to add additional parties as the project
          grows.
        </div>
      </>
    ),
  },

  {
    id: "owner-rug",
    q: "Can the owner steal funds or change the winner?",
    a: (
      <>
        <b>No</b>. Winner selection is enforced by the raffle contract and uses verifiable randomness from Pyth Entropy.
        <br />
        <br />
        Also, payouts are designed as <b>pull payments</b>:
        <ul className="faq-ul">
          <li>The contract records what each address is owed.</li>
          <li>Only that address can claim its own funds.</li>
        </ul>
        This is safer than “push payments” because it avoids sending funds automatically during a complex settlement step.
        <br />
        <br />
        The owner can pause in emergencies, but <b>cannot</b> arbitrarily redirect prize funds to themselves.
      </>
    ),
  },

  {
    id: "pull-payments",
    q: "What does “pull payments” mean, and why is it safer?",
    a: (
      <>
        “Pull payments” means the contract doesn’t try to automatically send money to multiple people during the draw.
        Instead:
        <ul className="faq-ul">
          <li>the contract records what you are owed,</li>
          <li>and you claim it yourself from your wallet when you want.</li>
        </ul>
        This pattern is widely used because it reduces failure cases (for example: one transfer failing shouldn’t break the whole
        settlement).
      </>
    ),
  },

  {
    id: "canceled",
    q: "What happens if a raffle is canceled?",
    a: (
      <>
        If a raffle is canceled, <b>no one loses funds</b>.
        <br />
        <br />
        <ul className="faq-ul">
          <li>🎟 Players can reclaim a <b>full refund</b> for their tickets.</li>
          <li>👤 The creator can reclaim their <b>original prize pot</b>.</li>
          <li>💸 <b>No fees</b> are taken on canceled raffles.</li>
        </ul>
        Refunds are done through the <b>Dashboard</b> (claim portal).
      </>
    ),
  },

  {
    id: "etherlink",
    q: "Why Etherlink?",
    a: (
      <>
        Etherlink is a Tezos Layer 2 with an EVM environment. It combines Tezos roots with an Ethereum-compatible developer
        experience.
        <br />
        <br />
        <ul className="faq-ul">
          <li>
            <b>Fast + low fees:</b> buying tickets feels smooth without expensive gas.
          </li>
          <li>
            <b>EVM compatibility:</b> works with common wallets like MetaMask.
          </li>
          <li>
            <b>Good UX:</b> quick confirmations make raffles feel responsive.
          </li>
        </ul>
      </>
    ),
  },

  {
    id: "open-source",
    q: "Is the code open-source?",
    a: (
      <>
        Yes. Links to the Frontend, Smart Contracts, and Finalizer Bot are available in the <b>Transparency</b> section of the site
        footer.
      </>
    ),
  },
];

// Helper for section headers
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="faq-section-header">
      <h2 className="faq-h2">{children}</h2>
    </div>
  );
}

export function FaqPage() {
  useEffect(() => {
    document.title = "Ppopgi 뽑기 — FAQ";
  }, []);

  const [openId, setOpenId] = useState<string | null>("what-is");
  const toggle = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  return (
    <div className="faq-page">
      {/* Hero Section */}
      <div className="faq-hero-card">
        <h1 className="faq-h1">FAQ & Rules</h1>
        <p className="faq-sub">Everything you need to know about trust, fees, and how Ppopgi works.</p>
      </div>

      {/* Mermaid Lifecycle */}
      <SectionTitle>How a Raffle Works</SectionTitle>
      <div className="faq-mermaid">
        <div className="faq-diagram-title">System State Flow</div>
        <MermaidDiagram code={RAFFLE_FLOW} id="ppopgi-raffle-lifecycle" />
        <div className="faq-diagram-note">Scroll to view the full lifecycle</div>
      </div>

      {/* Questions List */}
      <SectionTitle>Common Questions</SectionTitle>
      <div className="faq-list">
        {FAQ_ITEMS.map((it) => {
          const isOpen = openId === it.id;
          return (
            <div key={it.id} className={`faq-item ${isOpen ? "open" : ""}`}>
              <button className="faq-q" onClick={() => toggle(it.id)} aria-expanded={isOpen}>
                <span className="faq-q-text">{it.q}</span>
                <span className="faq-chevron">{isOpen ? "−" : "+"}</span>
              </button>

              <div className={`faq-a-wrapper ${isOpen ? "open" : ""}`}>
                <div className="faq-a">{it.a}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Note */}
      <div className="faq-footer-card">Still curious? Check the "Blockchain Journey" on any raffle card.</div>
    </div>
  );
}

export default FaqPage;
