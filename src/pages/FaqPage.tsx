// src/pages/FaqPage.tsx
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import "./FaqPage.css";

import { MermaidDiagram } from "../components/MermaidDiagram";
import { CONTRACTS, LINKS, explorerAddressUrl } from "../config/transparency";

type FaqItem = {
  id: string;
  q: string;
  a: ReactNode;
  tags?: string[];
};

type FaqSection = {
  id: string;
  title: string;
  items: FaqItem[];
};

const LOTTERY_FLOW = `
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
  C[Lottery OPEN]:::brand

  D{Max Tickets?}:::decision
  E{Deadline?}:::decision
  F{Min Tickets?}:::decision

  Bot[Finalizer Bot<br/>runs ~every 3 min]:::tech
  User[Any User]:::tech

  H[Drawing Phase]:::tech
  I[Pyth Entropy<br/>Verifiable Randomness]:::tech

  J[Winner Selected]:::success
  G[Lottery Canceled]:::fail

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

function LinkOut({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="rdm-info-link" target="_blank" rel="noreferrer" href={href}>
      {children} ↗
    </a>
  );
}

// Helper for section headers
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="faq-section-header">
      <h2 className="faq-h2">{children}</h2>
    </div>
  );
}

const FAQ_SECTIONS: FaqSection[] = [
  {
    id: "basics",
    title: "Basics",
    items: [
      {
        id: "what-is",
        q: "What is Ppopgi (뽑기)?",
        a: (
          <>
            Ppopgi (뽑기) is a friendly, on-chain lottery app on <b>Etherlink (Tezos L2, EVM)</b>.
            <br />
            <br />
            A typical lottery works like this:
            <ul className="faq-ul">
              <li>
                A <b>creator deposits a prize pot</b> (USDC) into a new lottery contract.
              </li>
              <li>
                Players <b>buy tickets</b> (USDC) while the lottery is open.
              </li>
              <li>
                When the lottery ends (sold out or deadline), a <b>winner is selected on-chain</b> using verifiable randomness.
              </li>
              <li>
                After the draw, funds are handled as <b>claims</b>: the winner claims the prize (minus protocol fees) and the creator
                claims ticket revenue (minus protocol fees).
              </li>
            </ul>
            <div className="faq-callout">
              Core idea: no hidden server logic deciding outcomes — the important rules are enforced by the lottery smart contract.
            </div>
          </>
        ),
        tags: ["basics", "overview"],
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
                <b>Good UX:</b> quick confirmations make lotteries feel responsive.
              </li>
            </ul>
          </>
        ),
        tags: ["basics", "chain"],
      },

      {
        id: "each-lottery-contract",
        q: "Is each lottery a new contract? How are lotteries secured?",
        a: (
          <>
            <b>Yes.</b> Each lottery is deployed as a <b>new smart contract instance</b> using the deployer.
            <br />
            <br />
            This has two big benefits:
            <ul className="faq-ul">
              <li>
                A lottery’s parameters (ticket price, deadline, max tickets, fee recipient, fee percent, etc.) are fixed inside that
                contract.
              </li>
              <li>
                Funds for that lottery are isolated in that contract. A bug or issue in one lottery should not automatically affect
                others.
              </li>
            </ul>
            <b>How funds are protected (in practice):</b>
            <ul className="faq-ul">
              <li>USDC is held by the lottery contract itself (not in a website wallet).</li>
              <li>There is no function intended to “withdraw everything to an arbitrary address”.</li>
              <li>
                Winner selection is enforced by contract logic and uses <b>Pyth Entropy</b> randomness.
              </li>
              <li>
                Payouts use <b>pull-based claims</b>: the contract records what you’re owed, and only your address can claim it.
              </li>
            </ul>
            <div className="faq-callout">
              Like any smart contract system, the remaining risk is “code risk” (unexpected bugs). The best reassurance is
              transparency: verified addresses, public source code, and on-chain behavior you can verify yourself.
            </div>
          </>
        ),
        tags: ["basics", "security"],
      },
    ],
  },

  {
    id: "trust-safety",
    title: "Trust & Safety",
    items: [
      {
        id: "randomness",
        q: "How does randomness work? Is it verifiable?",
        a: (
          <>
            Yes — the draw is verifiable and not “hidden” behind off-chain logic.
            <br />
            <br />
            Ppopgi (뽑기) uses <b>Pyth Entropy</b> as the randomness source:
            <ol className="faq-ol">
              <li>
                When a lottery is ready to settle (deadline reached or sold out), the lottery calls <code>finalize()</code> and requests
                a random value from Pyth Entropy (paying the Entropy fee).
              </li>
              <li>Entropy returns the random value <b>on-chain</b> via a callback.</li>
              <li>
                The lottery contract only accepts callbacks from the <b>Entropy contract address</b> and rejects invalid callbacks.
              </li>
              <li>
                The lottery selects a winner deterministically using <code>winningIndex = random % totalSold</code> and maps that index
                to a buyer using on-chain ticket ranges.
              </li>
            </ol>
            <div className="faq-callout">
              There is no private server picking the winner. The randomness is delivered on-chain, and the winner is computed by the
              contract.
            </div>
          </>
        ),
        tags: ["trust", "randomness"],
      },

      {
        id: "owner-rug",
        q: "Can anyone steal funds or change the winner?",
        a: (
          <>
            The winner selection is enforced by the lottery contract and uses verifiable randomness from Pyth Entropy.
            <br />
            <br />
            Payouts are pull-based:
            <ul className="faq-ul">
              <li>The contract records what each address is owed.</li>
              <li>Only that address can claim its own funds.</li>
            </ul>
            <br />
            This design helps protect users from “admin drains” because there is no function intended to move all funds to an
            arbitrary address.
            <div className="faq-callout">
              Important nuance: smart contracts reduce trust in people, but they don’t eliminate “code risk”. The best reassurance is
              transparency: verified contracts, public source code, and behavior you can verify on-chain.
            </div>
          </>
        ),
        tags: ["trust", "security"],
      },

      {
        id: "canceled",
        q: "What happens if a lottery is canceled?",
        a: (
          <>
            If a lottery is canceled, <b>no one loses funds</b>.
            <br />
            <br />
            <ul className="faq-ul">
              <li>🎟 Players can reclaim a <b>full refund</b> for their tickets.</li>
              <li>👤 The creator can reclaim their <b>original prize pot</b> (as a claim).</li>
              <li>💸 <b>No protocol fees</b> are allocated on canceled lotteries.</li>
            </ul>
            Refunds are done through the <b>Dashboard</b> (claim portal).
          </>
        ),
        tags: ["trust", "cancellation"],
      },

      {
        id: "stuck-drawing",
        q: "What if a lottery gets stuck while settling?",
        a: (
          <>
            Rarely, a lottery could get stuck during settlement (for example: delayed randomness callback, temporary provider issues,
            or unusual network conditions).
            <br />
            <br />
            To protect users, the contracts include an <b>emergency recovery</b> path:
            <ul className="faq-ul">
              <li>
                If a lottery stays in <b>Drawing</b> for too long, <b>anyone</b> can call an emergency function after a safety delay
                (the “hatch” period).
              </li>
              <li>This cancels the lottery and routes funds into the normal refund/claim flow.</li>
            </ul>
            <div className="faq-callout">
              Goal: a lottery should never remain stuck forever — there is always a public path to recover.
            </div>
          </>
        ),
        tags: ["trust", "recovery"],
      },

      {
        id: "pull-payments",
        q: "What does “pull payments” mean, and why is it safer?",
        a: (
          <>
            “Pull payments” means the contract doesn’t try to automatically send money to multiple people during the draw.
            <br />
            <br />
            Instead:
            <ul className="faq-ul">
              <li>the contract records what you are owed,</li>
              <li>and you claim it yourself from your wallet when you want.</li>
            </ul>
            This pattern is widely used because it reduces failure cases (for example: one transfer failing shouldn’t break the whole
            settlement).
          </>
        ),
        tags: ["trust", "payments"],
      },
    ],
  },

  {
    id: "fees-economics",
    title: "Fees & Economics",
    items: [
      {
        id: "fees",
        q: "What are the fees?",
        a: (
          <>
            Fees are transparent and enforced by the lottery contract when the lottery completes.
            <br />
            <br />
            Each lottery stores these values on-chain:
            <ul className="faq-ul">
              <li>
                <b>protocolFeePercent</b> (0–20%)
              </li>
              <li>
                <b>feeRecipient</b> (the address that can claim protocol fees)
              </li>
            </ul>
            At settlement time, the contract applies <b>protocolFeePercent</b> to:
            <ul className="faq-ul">
              <li>the prize pot (winner payout)</li>
              <li>the ticket revenue (creator payout)</li>
            </ul>
            <div className="faq-callout">
              You can verify the fee percent and fee recipient for any lottery directly on-chain (it’s part of that lottery’s
              immutable config).
            </div>
          </>
        ),
        tags: ["fees"],
      },

      {
        id: "why-fees",
        q: "Why are there fees?",
        a: (
          <>
            Ppopgi (뽑기) is self-funded and runs real infrastructure. Fees exist to cover operating costs such as:
            <ul className="faq-ul">
              <li>hosting and app infrastructure,</li>
              <li>RPC usage and reliability costs,</li>
              <li>running the finalizer bot,</li>
              <li>indexing / data services,</li>
              <li>maintenance and improvements over time.</li>
            </ul>
            If the project grows, fees may also help fund <b>special community events</b> and themed lotteries throughout the year.
          </>
        ),
        tags: ["fees"],
      },

      {
        id: "fees-fixed",
        q: "Are fees fixed once a lottery is created?",
        a: (
          <>
            Yes — once a lottery is created, its fee settings are <b>fixed for that lottery</b>.
            <br />
            <br />
            The deployer may update defaults for <b>future</b> lotteries, but existing lotteries remain unchanged.
          </>
        ),
        tags: ["fees"],
      },
    ],
  },

  {
    id: "usage-roles",
    title: "Usage & Roles",
    items: [
      {
        id: "permissions",
        q: "Who can do what? (Creator vs players vs protocol roles)",
        a: (
          <>
            Here’s the simple breakdown:
            <ul className="faq-ul">
              <li>
                <b>Players</b> can buy tickets and claim refunds/payouts when available.
              </li>
              <li>
                <b>Creators</b> choose lottery parameters, fund the prize pot, and can claim ticket revenue after settlement. Creators{" "}
                <b>cannot</b> buy tickets in their own lottery.
              </li>
              <li>
                <b>Registry/Deployer admins</b> can manage configuration for <b>future</b> lotteries (ex: set registrar, update
                deployer config). This does <b>not</b> let them rewrite outcomes of an already deployed lottery.
              </li>
            </ul>
            <div className="faq-callout">
              Best practice: treat smart contracts as the source of truth. You can verify a lottery’s rules (fee recipient, ticket
              price, deadline, etc.) on-chain for that lottery address.
            </div>
          </>
        ),
        tags: ["usage", "roles"],
      },

      // ✅ NEW: deployer admin explanation
      {
        id: "deployer-admin",
        q: "Who is the deployer admin?",
        a: (
          <>
            The “deployer admin” is the <b>admin/owner of the SingleWinnerDeployer contract</b> (the factory that creates new lottery
            instances).
            <br />
            <br />
            Today, this admin is a <b>multisig contract</b> controlled by <b>one signer (the project creator)</b>. If Ppopgi (뽑기) grows, the
            multisig can be updated to add more participants (multiple signers) for better shared governance and operational safety.
            <br />
            <br />
            You can always verify the deployer contract on-chain here:{" "}
            <LinkOut href={explorerAddressUrl(CONTRACTS.deployer)}>{CONTRACTS.deployer}</LinkOut>
            <div className="faq-callout">
              Important: deployer admin powers apply to <b>future lotteries</b> (configuration / deployment defaults). They do not let
              anyone change the outcome of an already deployed lottery.
            </div>
          </>
        ),
        tags: ["usage", "roles", "admin"],
      },

      {
        id: "ticket-ranges",
        q: "Why do ticket purchases use “ranges”?",
        a: (
          <>
            Ppopgi (뽑기) groups tickets into <b>on-chain ranges</b> when you buy.
            <br />
            <br />
            Instead of storing one entry per ticket (which becomes expensive fast), the contract stores purchases like:
            <div className="faq-callout">
              <code>[startTicketIndex … endTicketIndex] → buyerAddress</code>
            </div>
            So a single purchase of 25 tickets becomes <b>one range</b>, not 25 separate records.
            <br />
            <br />
            <b>Why this exists</b>
            <ul className="faq-ul">
              <li>
                <b>Lower gas costs:</b> ranges reduce storage writes compared to tracking every ticket individually.
              </li>
              <li>
                <b>Fast winner mapping:</b> when randomness gives a <code>winningIndex</code>, the contract finds the range that contains
                it and assigns the winner deterministically.
              </li>
              <li>
                <b>Prevents spam / bloat:</b> too many tiny buys would create lots of ranges and make the system heavier to operate.
              </li>
            </ul>
            <b>So why do I sometimes see a “minimum buy” warning?</b>
            <br />
            When the contract is close to using up its range capacity, opening a <b>new range</b> can be more expensive than extending an
            existing one. In those cases, the contract may require a slightly larger purchase to justify creating that new range.
            <br />
            <br />
            <div className="faq-callout">
              You can see this live per lottery in the <b>Ranges</b> tab inside the Lottery Details modal (tier, ranges used, and whether
              your next buy opens a new range).
            </div>
          </>
        ),
        tags: ["usage", "tickets", "ranges"],
      },

      {
        id: "finalizer-bot",
        q: "What is the finalizer bot?",
        a: (
          <>
            The finalizer bot is a simple automated helper that improves UX.
            <br />
            <br />
            It runs on a schedule (about <b>every ~3 minutes</b>) and checks for lotteries that are ready to settle (deadline reached or
            sold out). If it finds one, it can trigger settlement so lotteries don’t stay “waiting” forever.
            <br />
            <br />
            <div className="faq-callout">
              Important: the bot does not decide winners and cannot change outcomes — it only triggers the same public{" "}
              <code>finalize()</code> action that any user can call.
            </div>
          </>
        ),
        tags: ["usage", "ops"],
      },
    ],
  },

  {
    id: "transparency-tech",
    title: "Transparency & Tech",
    items: [
      {
        id: "tech-stack",
        q: "What is the Ppopgi (뽑기) tech stack / components?",
        a: (
          <>
            Ppopgi (뽑기) is made of a few components. Some are <b>on-chain</b> (custody + rules), and others are <b>off-chain</b> (speed + UX).
            <br />
            <br />
            <b>🧱 On-chain</b>
            <ul className="faq-ul">
              <li>
                <b>Lottery contracts (Etherlink / EVM):</b> hold USDC, enforce rules, request randomness, compute winner, and allocate
                claimable balances.
              </li>
              <li>
                <b>LotteryRegistry:</b> registry of deployed lotteries (discovery + indexing).
              </li>
              <li>
                <b>SingleWinnerDeployer:</b> deploys a new lottery contract per lottery and registers it in the registry.
              </li>
              <li>
                <b>Pyth Entropy:</b> on-chain verifiable randomness used for winner selection.
              </li>
            </ul>

            <b>🌐 Off-chain (operated by Ppopgi (뽑기) for a smooth UX)</b>
            <ul className="faq-ul">
              <li>
                <b>Frontend (React):</b> the UI that reads public chain data and sends transactions from your wallet.
              </li>
              <li>
                <b>Indexer (The Graph subgraph):</b> indexes contract events for fast lists, participants, and history views.
              </li>
              <li>
                <b>Edge cache worker:</b> caches GraphQL reads to reduce latency and load.
              </li>
              <li>
                <b>Finalizer bot:</b> periodically calls <code>finalize()</code> when lotteries are eligible (permissionless action).
              </li>
            </ul>

            <div className="faq-callout">
              Ppopgi (뽑기) provides the indexer, cache worker, and finalizer bot to make the experience smooth — but these services do{" "}
              <b>not</b> control funds and do <b>not</b> decide winners. They either read public data or call public functions that anyone
              can call.
            </div>
          </>
        ),
        tags: ["tech", "transparency"],
      },

      {
        id: "contracts-addresses",
        q: "What are the on-chain contract addresses?",
        a: (
          <>
            You can verify the core contracts on Etherlink Explorer:
            <ul className="faq-ul">
              <li>
                <b>Lottery Registry:</b>{" "}
                <LinkOut href={explorerAddressUrl(CONTRACTS.registry)}>{CONTRACTS.registry}</LinkOut>
              </li>
              <li>
                <b>SingleWinner Deployer:</b>{" "}
                <LinkOut href={explorerAddressUrl(CONTRACTS.deployer)}>{CONTRACTS.deployer}</LinkOut>
              </li>
              <li>
                <b>USDC token:</b> <LinkOut href={explorerAddressUrl(CONTRACTS.usdc)}>{CONTRACTS.usdc}</LinkOut>
              </li>
              <li>
                <b>Pyth Entropy contract:</b>{" "}
                <LinkOut href={explorerAddressUrl(CONTRACTS.pythEntropy)}>{CONTRACTS.pythEntropy}</LinkOut>
              </li>
              <li>
                <b>Entropy provider:</b>{" "}
                <LinkOut href={explorerAddressUrl(CONTRACTS.entropyProvider)}>{CONTRACTS.entropyProvider}</LinkOut>
              </li>
            </ul>

            <div className="faq-callout">
              Each lottery also has its <b>own contract address</b>. You can find it on the lottery card and on the Explorer.
            </div>
          </>
        ),
        tags: ["tech", "contracts"],
      },

      {
        id: "solidityscan",
        q: "Where can I find the contracts security score (SolidityScan)?",
        a: (
          <>
            You can review automated scan reports (static analysis) here:
            <br />
            <br />
            <LinkOut href={LINKS.solidityScanRegistry}>View LotteryRegistry SolidityScan report</LinkOut>
            <br />
            <LinkOut href={LINKS.solidityScanDeployer}>View LotteryDeployer SolidityScan report</LinkOut>
            <br />
            <br />
            <div className="faq-callout">
              Automated scanners are helpful, but they are not a substitute for a full audit. Always combine scans + manual review.
            </div>
          </>
        ),
        tags: ["tech", "security"],
      },

      {
        id: "audit",
        q: "Why haven’t the contracts been audited externally?",
        a: (
          <>
            External audits are valuable — they also cost real time and money. Ppopgi (뽑기) started as a lean project and prioritizes:
            <ul className="faq-ul">
              <li>simple contracts with fewer moving parts,</li>
              <li>public source code and on-chain verification,</li>
              <li>automated scanning + ongoing fixes,</li>
              <li>transparent communication about changes.</li>
            </ul>
            <div className="faq-callout">
              If usage grows, an external audit is a natural next step. Until then, the best defense is transparency: verify
              addresses, review code, and follow on-chain behavior.
            </div>
          </>
        ),
        tags: ["tech", "security"],
      },

      {
        id: "open-source",
        q: "Is the code open-source?",
        a: (
          <>
            Yes. Links to the Frontend, Smart Contracts, and Finalizer Bot are available in the <b>Transparency</b> section of the site
            footer.
            {LINKS.repoFrontend || LINKS.repoContracts || LINKS.repoFinalizerBot ? (
              <>
                <br />
                <br />
                <ul className="faq-ul">
                  {LINKS.repoFrontend ? (
                    <li>
                      <LinkOut href={LINKS.repoFrontend}>Frontend repository</LinkOut>
                    </li>
                  ) : null}
                  {LINKS.repoContracts ? (
                    <li>
                      <LinkOut href={LINKS.repoContracts}>Smart contracts repository</LinkOut>
                    </li>
                  ) : null}
                  {LINKS.repoFinalizerBot ? (
                    <li>
                      <LinkOut href={LINKS.repoFinalizerBot}>Finalizer bot repository</LinkOut>
                    </li>
                  ) : null}
                </ul>
              </>
            ) : null}
          </>
        ),
        tags: ["tech", "transparency"],
      },
    ],
  },
];

export function FaqPage() {
  useEffect(() => {
    document.title = "Ppopgi 뽑기 — FAQ";
  }, []);

  // ✅ collapse everything by default (including the first question)
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  return (
    <div className="faq-page">
      {/* Hero Section */}
      <div className="faq-hero-card">
        <h1 className="faq-h1">FAQ & Rules</h1>
        <p className="faq-sub">Everything you need to know about trust, fees, and how Ppopgi (뽑기) works.</p>
      </div>

      {/* Mermaid Lifecycle */}
      <SectionTitle>How a Lottery Works</SectionTitle>
      <div className="faq-mermaid">
        <div className="faq-diagram-title">System State Flow</div>
        <MermaidDiagram code={LOTTERY_FLOW} id="ppopgi-lottery-lifecycle" />
        <div className="faq-diagram-note">Scroll to view the full lifecycle</div>
      </div>

      {/* Questions List */}
      <SectionTitle>Common Questions</SectionTitle>

      {FAQ_SECTIONS.map((sec) => (
        <div key={sec.id} className="faq-block">
          <div className="faq-section-header" style={{ marginTop: 18 }}>
            <h3 className="faq-h3">{sec.title}</h3>
          </div>

          <div className="faq-list">
            {sec.items.map((it) => {
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
        </div>
      ))}

      {/* Footer Note */}
      <div className="faq-footer-card">Still curious? Check the "Blockchain Journey" on any lottery card.</div>
    </div>
  );
}

export default FaqPage;