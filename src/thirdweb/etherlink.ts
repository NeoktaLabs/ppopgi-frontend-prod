// src/thirdweb/etherlink.ts
import { defineChain } from "thirdweb/chains";

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}

export const ETHERLINK_CHAIN = defineChain({
  id: 42793,
  name: "Etherlink Mainnet",
  nativeCurrency: { name: "XTZ", symbol: "XTZ", decimals: 18 },
  rpc: mustEnv("VITE_ETHERLINK_RPC_URL"),
  blockExplorers: [
    {
      name: "Etherlink Explorer",
      url: "https://explorer.etherlink.com",
    },
  ],
});