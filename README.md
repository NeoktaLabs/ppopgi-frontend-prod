# Ppopgi (뽑기) Frontend

Ppopgi Frontend is the **user interface** of the Ppopgi on-chain raffle protocol, built to provide a smooth and intuitive experience for creating lotteries, buying tickets and tracking outcomes on **Etherlink**.

The app is a modern React + TypeScript single-page application powered by Vite. It integrates directly with the deployed smart contracts for all state-changing interactions while leveraging the Ppopgi subgraph for fast reads, activity feeds and historical data.

Key features include:
- Lottery discovery and detail views
- Ticket purchasing with wallet preparation and allowance flow
- Real-time activity feed and timeline tracking
- Participant distribution and ticket range visualization
- Creator dashboard and refund/claim flows
- Shareable lottery deep links and explorer integrations

The frontend follows a **trust-minimized architecture** where:
- Writes always go directly to smart contracts
- Reads are hydrated from both on-chain calls and indexed data
- All balances and critical states are verified against contracts

The interface is designed to feel playful and engaging while preserving transparency, deterministic behavior and clear lifecycle visibility for every lottery.