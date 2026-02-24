// src/lib/revalidate.ts

type Listener = () => void;

let listeners = new Set<Listener>();

let isRunning = false;
let timeout: any = null;

let currentDelay = 2000; // start at 2s
const MAX_DELAY = 30000; // max 30s
const BACKOFF_FACTOR = 1.5;

let targetBlock: number | null = null;
let getIndexerBlock: (() => number | null) | null = null;

/**
 * Subscribe to revalidation ticks
 */
export function subscribeRevalidate(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Called after a successful tx
 * Provide the tx block number
 */
export function requestRevalidate(txBlock?: number) {
  if (txBlock) {
    targetBlock = txBlock;
  }

  if (!isRunning) {
    isRunning = true;
    currentDelay = 2000;
    tick();
  }
}

/**
 * Allows app to provide latest indexed block number
 */
export function setIndexerBlockGetter(fn: () => number | null) {
  getIndexerBlock = fn;
}

/**
 * Core loop
 */
function tick() {
  if (!isRunning) return;

  // Notify listeners
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });

  // Check if we reached the target block
  if (targetBlock && getIndexerBlock) {
    const indexed = getIndexerBlock();
    if (indexed && indexed >= targetBlock) {
      stop();
      return;
    }
  }

  // Exponential backoff
  currentDelay = Math.min(MAX_DELAY, Math.floor(currentDelay * BACKOFF_FACTOR));

  timeout = setTimeout(tick, currentDelay);
}

function stop() {
  isRunning = false;
  targetBlock = null;
  if (timeout) {
    clearTimeout(timeout);
    timeout = null;
  }
}