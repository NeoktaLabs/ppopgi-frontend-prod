// src/main.tsx
import * as buffer from "buffer";

// ✅ Must exist before Ledger libs are dynamically imported later
const g: any = globalThis;
if (!g.Buffer) g.Buffer = buffer.Buffer;
if (!g.global) g.global = g;

// --- Phase 0: baseline perf marks (boot) ---
try {
  // Mark as early as possible in the entrypoint
  performance.mark("ppopgi:boot_start");
} catch {
  // ignore (older browsers / disabled perf API)
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ThirdwebProvider } from "thirdweb/react";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThirdwebProvider>
      <App />
    </ThirdwebProvider>
  </StrictMode>
);

// Optional: mark after the synchronous render call completes.
// Note: React may still be committing work asynchronously, so "app_mounted"
// should be marked from inside App.tsx.
try {
  performance.mark("ppopgi:react_render_called");
  performance.measure(
    "ppopgi:boot_to_render_called",
    "ppopgi:boot_start",
    "ppopgi:react_render_called"
  );
} catch {
  // ignore
}