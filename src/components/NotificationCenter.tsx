// src/components/NotificationCenter.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useActivityStore } from "../hooks/useActivityStore";
import { useLotteryStore } from "../hooks/useLotteryStore";
import { useConfetti } from "../hooks/useConfetti";
import { fmtUsdcUi } from "../lib/format";
import { formatUnits } from "ethers";
import { fetchGlobalActivity } from "../indexer/subgraph";
import "./NotificationCenter.css";

type ActivityItem = {
  type: "BUY" | "CREATE" | "WIN" | "CANCEL";
  lotteryId: string;
  lotteryName: string;
  subject: string;
  value: string;
  timestamp: string;
  txHash: string;
  pending?: boolean;
};

type ToastKind = "info" | "success" | "danger";

type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  showConfetti?: boolean;
};

type SummaryLine = {
  icon: string;
  text: string;
  time: string;
};

type SummaryModal = {
  id: string;
  title: string;
  lines: SummaryLine[];
};

// 5 seconds total duration
const TOAST_MS = 6000;

const LS_TOASTS_ENABLED_A = "ppopgi:toastEnabled";
const LS_TOASTS_ENABLED_B = "ppopgi_toasts_enabled";
const LS_LAST_SEEN_PREFIX = "ppopgi_last_seen_";
const LS_PARTICIPATED_PREFIX = "ppopgi_participated_";
const SS_SESSION_PREFIX = "ppopgi_notif_session_";

function lc(a: string | null | undefined) {
  return String(a || "").toLowerCase();
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function parseSec(s: string) {
  const n = Number(s || "0");
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function fmtUsdcFromU6(u6: string) {
  try {
    const s = formatUnits(BigInt(u6 || "0"), 6);
    return fmtUsdcUi(s);
  } catch {
    return "0";
  }
}

function fmtWhen(tsSecStr: string) {
  const sec = parseSec(tsSecStr);
  if (!sec) return "";
  const d = new Date(sec * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, v: any) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

function readToastsEnabled(): boolean {
  try {
    const vA = localStorage.getItem(LS_TOASTS_ENABLED_A);
    if (vA != null) return vA === "true";
    const vB = localStorage.getItem(LS_TOASTS_ENABLED_B);
    if (vB != null) return vB === "true";
    return true;
  } catch {
    return true;
  }
}

function setLastSeen(account: string, tsSec: number) {
  try {
    localStorage.setItem(`${LS_LAST_SEEN_PREFIX}${lc(account)}`, String(tsSec));
  } catch {}
}

function getLastSeen(account: string): number {
  try {
    const raw = localStorage.getItem(`${LS_LAST_SEEN_PREFIX}${lc(account)}`);
    const n = Number(raw || "0");
    return Number.isFinite(n) ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function getParticipatedSet(account: string): Set<string> {
  const key = `${LS_PARTICIPATED_PREFIX}${lc(account)}`;
  const arr = loadJson<string[]>(key, []);
  return new Set((arr || []).map((x) => lc(x)));
}

function addParticipated(account: string, lotteryId: string) {
  const key = `${LS_PARTICIPATED_PREFIX}${lc(account)}`;
  const set = getParticipatedSet(account);
  set.add(lc(lotteryId));
  saveJson(key, Array.from(set));
}

function shortAddr(a: string) {
  const s = lc(a);
  if (!s) return "—";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function readSessionFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeSessionFlag(key: string, on: boolean) {
  try {
    sessionStorage.setItem(key, on ? "1" : "0");
  } catch {}
}

export function NotificationCenter() {
  const acct = useActiveAccount();
  const me = acct?.address ?? null;
  const meLc = lc(me);

  const { fireConfetti } = useConfetti();
  const lotteryStore = useLotteryStore("notif-center", 60_000);
  const activity = useActivityStore();

  const [toastsEnabled, setToastsEnabled] = useState<boolean>(() => readToastsEnabled());
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [summary, setSummary] = useState<SummaryModal | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  const shouldRunSummaryThisSessionRef = useRef(false);
  const seenTxRef = useRef<Set<string>>(new Set());
  const seededFromInitialActivityRef = useRef(false);

  useEffect(() => {
    seenTxRef.current = new Set();
    seededFromInitialActivityRef.current = false;
    setSummary(null);
    setSummaryExpanded(false);
    setToast(null);

    if (!meLc) {
      shouldRunSummaryThisSessionRef.current = false;
      return;
    }

    const ssKey = `${SS_SESSION_PREFIX}${meLc}`;
    const alreadyStarted = readSessionFlag(ssKey);
    if (!alreadyStarted) {
      writeSessionFlag(ssKey, true);
      shouldRunSummaryThisSessionRef.current = true;
    } else {
      shouldRunSummaryThisSessionRef.current = false;
    }
  }, [meLc]);

  const clearToast = useCallback(() => {
    setToast(null);
    if (toastTimerRef.current != null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const clearSummary = useCallback(() => {
    setSummary(null);
    setSummaryExpanded(false);
  }, []);

  const showToast = useCallback(
    (t: Toast) => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
      setToast(t);

      if (t.showConfetti) {
        try {
          fireConfetti();
        } catch {}
      }

      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, TOAST_MS);
    },
    [fireConfetti]
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onSettingA = (ev: Event) => {
      const d = (ev as CustomEvent<{ enabled?: boolean }>).detail;
      if (typeof d?.enabled === "boolean") setToastsEnabled(d.enabled);
      else setToastsEnabled(readToastsEnabled());
    };
    const onSettingB = () => setToastsEnabled(readToastsEnabled());

    window.addEventListener("ppopgi:toast-pref", onSettingA as any);
    window.addEventListener("ppopgi:toast-setting", onSettingB as any);

    return () => {
      window.removeEventListener("ppopgi:toast-pref", onSettingA as any);
      window.removeEventListener("ppopgi:toast-setting", onSettingB as any);
    };
  }, []);

  const creatorOf = useCallback(
    (lotteryId: string) => {
      const id = lc(lotteryId);
      const it = (lotteryStore.items || []).find((x: any) => lc(String(x?.id || "")) === id);
      return lc(String((it as any)?.creator || (it as any)?.owner || "")) || "";
    },
    [lotteryStore.items]
  );

  const isParticipant = useCallback(
    (lotteryId: string) => {
      if (!me) return false;
      const set = getParticipatedSet(me);
      return set.has(lc(lotteryId));
    },
    [me]
  );

  useEffect(() => {
    if (!me) return;
    if (seededFromInitialActivityRef.current) return;

    const items = (activity.items || []) as ActivityItem[];
    if (!items.length) return;

    for (const it of items) {
      if ((it as any)?.pending) continue;
      const tx = String((it as any)?.txHash || "");
      if (tx) seenTxRef.current.add(tx);
    }

    seededFromInitialActivityRef.current = true;
  }, [me, activity.items]);

  useEffect(() => {
    if (!me) return;
    if (!toastsEnabled) return;
    if (summary) return;
    if (!seededFromInitialActivityRef.current) return;

    const items = (activity.items || []) as ActivityItem[];
    if (!items.length) return;

    const windowItems = items.slice(0, 25).reverse();

    for (const d of windowItems) {
      const txHash = String((d as any)?.txHash || "");
      if (!txHash) continue;

      if (seenTxRef.current.has(txHash)) continue;
      if ((d as any)?.pending) continue;

      seenTxRef.current.add(txHash);

      const type = d.type;
      const lotId = lc(d.lotteryId);
      const name = String(d.lotteryName || "Lottery");
      const subj = lc(d.subject);
      const value = String(d.value || "0");

      if (!lotId || !type) continue;

      if (type === "BUY" && subj === meLc) {
        addParticipated(me, lotId);
        continue;
      }

      const creator = creatorOf(lotId);
      const amCreator = !!creator && creator === meLc;
      const amParticipant = isParticipant(lotId);

      // --- TEXT FORMATTING FOR ONE-LINE ANNOUNCEMENT ---
      // We put the key info in 'title' so it shows up bold/prominent

      if (type === "BUY" && amCreator && subj !== meLc) {
        showToast({ id: `t:${txHash}`, kind: "info", title: `🎟️ ${value} tickets sold on “${name}”` });
        continue;
      }

      if (type === "CANCEL" && amParticipant) {
        showToast({ id: `t:${txHash}`, kind: "danger", title: `⛔ “${name}” canceled! Head to your dashboard to reclaim your ticket(s)!` });
        continue;
      }

      if (type === "CANCEL" && amCreator) {
        showToast({ id: `t:${txHash}`, kind: "danger", title: `⛔ Your lottery “${name}” was canceled. Minimum tickets not reached.` });
        continue;
      }

      if (type === "WIN") {
        const potUi = fmtUsdcFromU6(value);

        if (subj === meLc) {
          showToast({
            id: `t:${txHash}`,
            kind: "success",
            title: `🏆 CONGRATULATIONS! YOU WON ${potUi} USDC on “${name}”!`,
            showConfetti: true,
          });
          continue;
        }

        if (amParticipant) {
          showToast({ id: `t:${txHash}`, kind: "info", title: `✅ “${name}” ended — Winner: ${shortAddr(subj)}` });
          continue;
        }

        if (amCreator) {
          showToast({ id: `t:${txHash}`, kind: "success", title: `🏁 “${name}” finished — Revenue ready` });
          continue;
        }
      }
    }
  }, [me, meLc, toastsEnabled, summary, activity.items, creatorOf, isParticipant, showToast]);

  const inFlightSummaryRef = useRef(false);

  const openDashboard = useCallback(() => {
    clearSummary();
    try {
      window.dispatchEvent(new CustomEvent("ppopgi:navigate", { detail: { page: "dashboard" } }));
    } catch {
      window.location.href = "/?page=dashboard";
    }
  }, [clearSummary]);

  const buildSummaryLines = useCallback(
    (items: ActivityItem[]): SummaryLine[] => {
      if (!me) return [];
      const participated = getParticipatedSet(me);
      const lines: SummaryLine[] = [];

      for (const it of items) {
        const type = it.type;
        const lotId = lc(it.lotteryId);
        const name = String(it.lotteryName || "Lottery");
        const subj = lc(it.subject);
        const when = fmtWhen(it.timestamp);
        const creator = creatorOf(lotId);
        const amCreator = creator && creator === meLc;
        const amParticipant = participated.has(lotId);

        if (type === "BUY" && amCreator && subj !== meLc) {
          lines.push({ icon: "🎟️", text: `${it.value} tickets sold on “${name}”`, time: when });
          continue;
        }
        if (type === "CANCEL") {
          if (amParticipant) lines.push({ icon: "⛔", text: `“${name}” canceled (refund available)`, time: when });
          else if (amCreator) lines.push({ icon: "⛔", text: `Your lottery “${name}” canceled`, time: when });
          continue;
        }
        if (type === "WIN") {
          const potUi = fmtUsdcFromU6(it.value);
          if (subj === meLc) {
            lines.push({ icon: "🏆", text: `YOU WON ${potUi} USDC on “${name}”!`, time: when });
            continue;
          }
          if (amParticipant) {
            lines.push({ icon: "✅", text: `“${name}” finalized and someone won! Better luck next time!`, time: when });
            continue;
          }
          if (amCreator) {
            lines.push({ icon: "🏁", text: `“${name}” finished successfully. Head to the dashboard to reclaim your tickets revenue!`, time: when });
            continue;
          }
        }
      }
      return lines;
    },
    [me, meLc, creatorOf]
  );

  const maybeShowSummary = useCallback(async () => {
    if (!me) return;
    if (!shouldRunSummaryThisSessionRef.current) return;
    shouldRunSummaryThisSessionRef.current = false;

    if (summary) return;
    if (inFlightSummaryRef.current) return;
    inFlightSummaryRef.current = true;

    try {
      const lastSeen = getLastSeen(me);
      if (!lastSeen) {
        const latest = await fetchGlobalActivity({ first: 50, forceFresh: true });
        const items = (latest || []).filter((x: any) => !x?.pending) as ActivityItem[];
        const newestTs = Math.max(0, ...items.map((it) => parseSec(String(it?.timestamp || "0"))));
        setLastSeen(me, newestTs > 0 ? newestTs : nowSec());
        const lines = buildSummaryLines(items);
        if (lines.length === 0) return;
        setSummaryExpanded(false);
        setSummary({
          id: `summary:first:${newestTs || Date.now()}`,
          title: "While you were away",
          lines,
        });
        return;
      }

      const sinceItemsRaw = await fetchGlobalActivity({ first: 50, sinceSec: lastSeen, forceFresh: true });
      const sinceItems = (sinceItemsRaw || []).filter((x: any) => !x?.pending) as ActivityItem[];
      if (sinceItems.length === 0) return;

      const newestTs = Math.max(...sinceItems.map((it) => parseSec(it.timestamp)));
      if (newestTs > 0) setLastSeen(me, newestTs);

      const lines = buildSummaryLines(sinceItems);
      if (lines.length === 0) return;

      setSummaryExpanded(false);
      setSummary({
        id: `summary:${newestTs || Date.now()}`,
        title: "While you were away",
        lines,
      });
    } catch {
    } finally {
      inFlightSummaryRef.current = false;
    }
  }, [me, summary, buildSummaryLines]);

  useEffect(() => {
    if (!me) return;
    void maybeShowSummary();
  }, [me, maybeShowSummary]);

  if (!toast && !summary) return null;

  // 1. SUMMARY MODAL
  if (summary) {
    const collapsedCount = 8;
    const canExpand = summary.lines.length > collapsedCount;
    const visibleLines = summaryExpanded ? summary.lines : summary.lines.slice(0, collapsedCount);

    return (
      <div className="pp-toast-wrap is-modal show" onMouseDown={clearSummary}>
        <div className="pp-toast pp-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="pp-toast-header">
            <div className="pp-toast-title">👋 {summary.title}</div>
            <button className="pp-modal-close" onClick={clearSummary}>✕</button>
          </div>
          <div className="pp-toast-body">
            <ul className="pp-summary-list">
              {visibleLines.map((line, idx) => (
                <li key={`${summary.id}:${idx}`}>
                  <div className="pp-sl-left">
                    <span className="pp-sl-icon">{line.icon}</span>
                    <span className="pp-sl-text">{line.text}</span>
                  </div>
                  <div className="pp-sl-time">{line.time}</div>
                </li>
              ))}
            </ul>
            {canExpand && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                <button
                  type="button"
                  className="pp-btn secondary"
                  onClick={() => setSummaryExpanded((v) => !v)}
                  style={{ maxWidth: 220 }}
                >
                  {summaryExpanded ? "Show less" : `Show more (${summary.lines.length - collapsedCount})`}
                </button>
              </div>
            )}
            <div className="pp-modal-actions">
              <button onClick={openDashboard} className="pp-btn primary">Go to Dashboard</button>
              <button onClick={clearSummary} className="pp-btn secondary">Dismiss</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. WIDE BANNER TOAST (Left -> Right)
  return (
    <div className={`pp-toast-wrap is-toast ${toast ? "show" : ""}`}>
      <div className={`pp-toast pp-${toast!.kind}`} onClick={clearToast}>
        {/* Horizontal flex layout for single line */}
        <div className="pp-toast-row">
          <div className="pp-toast-icon">{toast!.kind === "success" ? "🎉" : toast!.kind === "danger" ? "⚠️" : "📢"}</div>
          <div className="pp-toast-text">
            <span className="pp-toast-title-inline">{toast!.title}</span>
            {toast!.body && <span className="pp-toast-body-inline"> — {toast!.body}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
