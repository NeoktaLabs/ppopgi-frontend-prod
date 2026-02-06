// src/state/useSession.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Connector = "thirdweb" | null;

export type SessionState = {
  account: string | null;
  connector: Connector;

  set: (s: Partial<SessionState>) => void;
  clear: () => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      account: null,
      connector: null,

      set: (s) => set(s),

      clear: () =>
        set({
          account: null,
          connector: null,
        }),
    }),
    {
      name: "ppopgi-session",
      partialize: (s) => ({
        account: s.account,
        connector: s.connector,
      }),
    }
  )
);