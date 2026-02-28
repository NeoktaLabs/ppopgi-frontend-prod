import { useCallback, useMemo, useRef, useState } from "react";
import { EIP1193 } from "thirdweb/wallets";
import type { ThirdwebClient } from "thirdweb";
import type { Chain } from "thirdweb/chains";
import { Transaction, Signature, hexlify, getBytes } from "ethers";

type HID = any;
type HIDDevice = any;

async function rpcRequest(rpcUrl: string, method: string, params: any[] = []) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok || json?.error) {
    const msg = json?.error?.message || `RPC_ERROR_${res.status}`;
    throw new Error(`${msg} (rpc:${method})`);
  }

  return json.result;
}

function pickRpcUrl(chain: Chain): string {
  const rpc: any = (chain as any)?.rpc;
  if (typeof rpc === "string" && rpc) return rpc;
  if (Array.isArray(rpc) && rpc[0]) return String(rpc[0]);
  throw new Error("No RPC URL found for chain.");
}

function asHexQuantity(v: any): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  try {
    const bi = typeof v === "bigint" ? v : BigInt(v);
    return "0x" + bi.toString(16);
  } catch {
    return undefined;
  }
}

function hexToBigInt(v?: string | null): bigint {
  try {
    if (!v) return 0n;
    const s = String(v);
    if (!s || s === "0x" || s === "0x0" || s === "0" || s === "0x00") return 0n;
    return BigInt(s);
  } catch {
    return 0n;
  }
}

function bumpGas(gas: bigint, bumpBps = 1200n): bigint {
  if (gas <= 0n) return gas;
  return (gas * (10_000n + bumpBps)) / 10_000n;
}

function isZeroHex(v: any): boolean {
  if (v == null) return true;
  if (typeof v === "number") return v === 0;
  if (typeof v === "bigint") return v === 0n;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    return s === "0x0" || s === "0x" || s === "0" || s === "0x00";
  }
  try {
    return BigInt(v) === 0n;
  } catch {
    return false;
  }
}

function sanitizeTxForEstimate(tx: any): any {
  const t = { ...(tx ?? {}) };

  if ("gas" in t && isZeroHex(t.gas)) delete t.gas;
  if ("gasLimit" in t && isZeroHex(t.gasLimit)) delete t.gasLimit;

  if (!t.data) t.data = "0x";
  if (t.value == null || isZeroHex(t.value)) t.value = "0x0";

  return t;
}

type LedgerSession = {
  transport: any;
  eth: any;
  address: string;
  path: string;
};

type LedgerScanRow = { path: string; address: string };

const LEDGER_VENDOR_ID = 0x2c97;

function assertWebHid() {
  const hid: any = (navigator as any)?.hid;
  if (!hid?.requestDevice) {
    throw new Error("WebHID not available. Use Chrome / Edge / Brave (desktop).");
  }
  return hid as HID;
}

async function openLedgerTransportAndEth(opts: { device?: HIDDevice } = {}): Promise<{ transport: any; eth: any }> {
  const [{ default: TransportWebHID }, { default: Eth }] = await Promise.all([
    import("@ledgerhq/hw-transport-webhid"),
    import("@ledgerhq/hw-app-eth"),
  ]);

  let transport: any = null;

  // ✅ If caller already selected a device, ALWAYS use it (no prompting here)
  if (opts.device) {
    transport = await (TransportWebHID as any).open(opts.device);
    const eth = new Eth(transport);
    return { transport, eth };
  }

  // Otherwise try silent open (only works if permission already granted)
  try {
    const hid: any = (navigator as any)?.hid;
    const devices = await hid?.getDevices?.();
    if (devices?.length) {
      transport = await (TransportWebHID as any).open(devices[0]);
    }
  } catch {
    transport = null;
  }

  if (!transport) {
    // IMPORTANT: we do NOT call requestDevice() here anymore
    // because this function is often reached after async boundaries.
    throw new Error("Ledger device not selected yet. Click “Connect Ledger” again to choose the device.");
  }

  const eth = new Eth(transport);
  return { transport, eth };
}

async function openLedgerSession(path: string, device?: HIDDevice): Promise<LedgerSession> {
  const { transport, eth } = await openLedgerTransportAndEth({ device });
  const { address } = await eth.getAddress(path, false, true);
  return { transport, eth, address, path };
}

type Eip1193RequestArgs = { method: string; params?: any };

type MinimalEip1193Provider = {
  request: (args: Eip1193RequestArgs) => Promise<any>;
  on: (event: string, listener: (...args: any[]) => void) => any;
  removeListener: (event: string, listener: (...args: any[]) => void) => any;
};

function emptyLedgerResolution() {
  return {
    domains: [] as any[],
    erc20Tokens: [] as any[],
    nfts: [] as any[],
    externalPlugin: [] as any[],
    plugin: [] as any[],
  };
}

function normalizeParams(params: any): any[] {
  if (Array.isArray(params)) return params;
  if (params == null) return [];
  if (typeof params === "object") return [params];
  return [];
}

async function createLedgerEip1193Provider(opts: {
  chainId: number;
  rpcUrl: string;
  sessionRef: { current: LedgerSession | null };
  preferredPath?: string;
  deviceRef: { current: HIDDevice | null };
}): Promise<MinimalEip1193Provider> {
  const { chainId, rpcUrl, sessionRef, preferredPath, deviceRef } = opts;
  const hexChainId = `0x${chainId.toString(16)}`;

  async function getSession() {
    if (sessionRef.current) return sessionRef.current;

    const path = preferredPath || "44'/60'/0'/0/0";
    const s = await openLedgerSession(path, deviceRef.current ?? undefined);
    sessionRef.current = s;
    return s;
  }

  const on: MinimalEip1193Provider["on"] = () => undefined;
  const removeListener: MinimalEip1193Provider["removeListener"] = () => undefined;

  const passthrough = async (method: string, params?: any) => {
    const p = normalizeParams(params);
    return await rpcRequest(rpcUrl, method, p);
  };

  return {
    on,
    removeListener,

    async request({ method, params }: Eip1193RequestArgs) {
      const p = normalizeParams(params);

      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts": {
          const s = await getSession();
          return [s.address];
        }

        case "eth_chainId":
          return hexChainId;

        case "wallet_switchEthereumChain": {
          const [{ chainId: requested } = {} as any] = p as any[];
          if (requested && requested !== hexChainId) {
            throw new Error(`Ledger USB: chain ${requested} not supported (expected ${hexChainId}).`);
          }
          return null;
        }

        case "eth_estimateGas": {
          const [tx, blockTag] = p as any[];
          const clean = sanitizeTxForEstimate(tx);
          return await rpcRequest(rpcUrl, "eth_estimateGas", blockTag != null ? [clean, blockTag] : [clean]);
        }

        case "eth_sendTransaction": {
          const [txRaw] = p as any[];
          if (!txRaw) throw new Error("Missing transaction object.");

          const tx = sanitizeTxForEstimate(txRaw);
          const s = await getSession();

          const from = String(tx.from || "").toLowerCase();
          if (!from) throw new Error("Transaction missing from.");
          if (from !== s.address.toLowerCase()) {
            throw new Error(`Ledger USB: tx.from must be the Ledger address (${s.address}).`);
          }

          const to = tx.to ? String(tx.to) : undefined;
          const data = tx.data ? String(tx.data) : "0x";
          const value = tx.value != null ? BigInt(tx.value) : 0n;

          const nonceHex =
            tx.nonce != null
              ? asHexQuantity(tx.nonce)
              : await rpcRequest(rpcUrl, "eth_getTransactionCount", [s.address, "pending"]);

          if (!nonceHex) throw new Error("Failed to resolve nonce.");

          let maxFeePerGasHex = asHexQuantity(tx.maxFeePerGas);
          let maxPriorityFeePerGasHex = asHexQuantity(tx.maxPriorityFeePerGas);
          let gasPriceHex = asHexQuantity(tx.gasPrice);

          if (hexToBigInt(maxFeePerGasHex) === 0n) maxFeePerGasHex = undefined;
          if (hexToBigInt(maxPriorityFeePerGasHex) === 0n) maxPriorityFeePerGasHex = undefined;
          if (hexToBigInt(gasPriceHex) === 0n) gasPriceHex = undefined;

          if (!maxFeePerGasHex && !gasPriceHex) {
            gasPriceHex = await rpcRequest(rpcUrl, "eth_gasPrice", []);
          }

          const is1559 = !!(maxFeePerGasHex || maxPriorityFeePerGasHex);
          const gasPriceHexResolved = gasPriceHex ?? "0x0";
          const maxFeeHexResolved = maxFeePerGasHex ?? gasPriceHexResolved;
          const maxPrioHexResolved = maxPriorityFeePerGasHex ?? "0x3b9aca00";

          const estimateCall: any = { from: tx.from, to, data, value: tx.value ?? "0x0" };
          if (is1559) {
            estimateCall.maxFeePerGas = maxFeeHexResolved;
            estimateCall.maxPriorityFeePerGas = maxPrioHexResolved;
          } else {
            estimateCall.gasPrice = gasPriceHexResolved;
          }

          let estimatedGasBI = 0n;
          try {
            const estHex = await rpcRequest(rpcUrl, "eth_estimateGas", [estimateCall]);
            estimatedGasBI = hexToBigInt(estHex);
          } catch {
            estimatedGasBI = 650_000n;
          }

          if (estimatedGasBI <= 0n) estimatedGasBI = 650_000n;
          const finalGas = bumpGas(estimatedGasBI, 1200n);

          const unsignedTx = Transaction.from({
            chainId,
            to,
            nonce: Number(BigInt(nonceHex)),
            gasLimit: finalGas,
            data,
            value,
            ...(is1559
              ? { maxFeePerGas: BigInt(maxFeeHexResolved), maxPriorityFeePerGas: BigInt(maxPrioHexResolved) }
              : { gasPrice: BigInt(gasPriceHexResolved) }),
          });

          const payloadHex = unsignedTx.unsignedSerialized.startsWith("0x")
            ? unsignedTx.unsignedSerialized.slice(2)
            : unsignedTx.unsignedSerialized;

          const resolution = emptyLedgerResolution();
          const sig = await s.eth.signTransaction(s.path, payloadHex, resolution);

          const v = BigInt("0x" + sig.v);
          const r = "0x" + sig.r;
          const sSig = "0x" + sig.s;

          const signature = Signature.from({ v, r, s: sSig });
          const txData = unsignedTx.toJSON();
          const signedTx = Transaction.from({ ...txData, signature }).serialized;

          return await rpcRequest(rpcUrl, "eth_sendRawTransaction", [signedTx]);
        }

        case "personal_sign": {
          const s = await getSession();
          const [message, address] = p as any[];

          const addr = String(address || "").toLowerCase();
          if (addr && addr !== s.address.toLowerCase()) {
            throw new Error("Ledger USB: personal_sign address mismatch.");
          }

          const bytes =
            typeof message === "string" && message.startsWith("0x")
              ? getBytes(message)
              : new TextEncoder().encode(String(message ?? ""));

          const res = await s.eth.signPersonalMessage(s.path, hexlify(bytes).slice(2));
          return "0x" + res.r + res.s + res.v.toString(16).padStart(2, "0");
        }

        default: {
          if (method.startsWith("eth_") || method.startsWith("net_") || method.startsWith("web3_")) {
            return await passthrough(method, params);
          }
          throw new Error(`Unsupported method: ${method}`);
        }
      }
    },
  };
}

export function useLedgerUsbWallet() {
  const isSupported = useMemo(() => typeof (navigator as any)?.hid !== "undefined", []);

  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState("");

  const sessionRef = useRef<LedgerSession | null>((globalThis as any).__ppopgiLedgerSession ?? null);
  (globalThis as any).__ppopgiLedgerSession = sessionRef.current;

  // ✅ NEW: cache the HID device chosen by the user
  const deviceRef = useRef<HIDDevice | null>((globalThis as any).__ppopgiLedgerDevice ?? null);
  (globalThis as any).__ppopgiLedgerDevice = deviceRef.current;

  /**
   * ✅ NEW: Must be called directly from a button click (no awaits before calling it).
   * This is what guarantees the Chrome HID chooser prompt shows up.
   */
  const ensureLedgerDevice = useCallback(async () => {
    setError("");
    if (!isSupported) throw new Error("WebHID not supported. Use Chrome/Edge/Brave.");

    const hid = assertWebHid();

    const devices = await hid.requestDevice({
      filters: [{ vendorId: LEDGER_VENDOR_ID }],
    });

    if (!devices || devices.length === 0) {
      throw new Error("No Ledger device selected. Please select your Ledger in the browser prompt.");
    }

    deviceRef.current = devices[0];
    (globalThis as any).__ppopgiLedgerDevice = deviceRef.current;

    return deviceRef.current;
  }, [isSupported]);

  const setSelectedPath = useCallback(
    async (path: string) => {
      setError("");
      if (!isSupported) throw new Error("WebHID not supported. Use Chrome/Edge/Brave.");

      try {
        await sessionRef.current?.transport?.close?.();
      } catch {}
      sessionRef.current = null;

      // requires device to be selected already (or silent permission)
      const s = await openLedgerSession(path, deviceRef.current ?? undefined);
      sessionRef.current = s;
      (globalThis as any).__ppopgiLedgerSession = sessionRef.current;
      return { address: s.address, path: s.path };
    },
    [isSupported]
  );

  const scanAccounts = useCallback(
    async (opts: { basePath: string; startIndex?: number; count?: number }) => {
      setError("");
      if (!isSupported) throw new Error("WebHID not supported. Use Chrome/Edge/Brave.");

      const base = String(opts.basePath || "").trim();
      const start = Math.max(0, Number(opts.startIndex ?? 0));
      const count = Math.max(1, Math.min(25, Number(opts.count ?? 5)));

      let tempTransport: any = null;
      let eth: any = null;

      try {
        if (sessionRef.current?.eth && sessionRef.current?.transport) {
          eth = sessionRef.current.eth;
        } else {
          const opened = await openLedgerTransportAndEth({ device: deviceRef.current ?? undefined });
          tempTransport = opened.transport;
          eth = opened.eth;
        }

        const out: LedgerScanRow[] = [];
        for (let i = 0; i < count; i++) {
          const idx = start + i;
          const fullPath = `${base}/${idx}`;
          const { address } = await eth.getAddress(fullPath, false, true);
          out.push({ path: fullPath, address });
        }
        return out;
      } finally {
        if (tempTransport) {
          try {
            await tempTransport.close?.();
          } catch {}
        }
      }
    },
    [isSupported]
  );

  const connectLedgerUsb = useCallback(
    async (opts: { client: ThirdwebClient; chain: Chain; preferredPath?: string }) => {
      setError("");
      if (!isSupported) throw new Error("WebHID not supported. Use Chrome/Edge/Brave.");

      setIsConnecting(true);
      try {
        const rpcUrl = pickRpcUrl(opts.chain);

        // ✅ Require device selection already OR previously granted permission
        // If neither is true, show a clean message telling the UI what to do.
        if (!deviceRef.current) {
          try {
            const hid: any = (navigator as any)?.hid;
            const granted = await hid?.getDevices?.();
            if (!granted?.length) {
              throw new Error(
                "Ledger not selected yet. Click “Connect Ledger” again and choose the Ledger device in the browser prompt."
              );
            }
          } catch (e: any) {
            throw e;
          }
        }

        const wallet = EIP1193.fromProvider({
          provider: async () => {
            return await createLedgerEip1193Provider({
              chainId: opts.chain.id,
              rpcUrl,
              sessionRef,
              preferredPath: opts.preferredPath,
              deviceRef,
            });
          },
        });

        await wallet.connect({ client: opts.client, chain: opts.chain });

        (globalThis as any).__ppopgiLedgerSession = sessionRef.current;
        (globalThis as any).__ppopgiLedgerDevice = deviceRef.current;

        return wallet;
      } catch (e: any) {
        setError(e?.message ? String(e.message) : "Failed to connect Ledger via USB.");
        throw e;
      } finally {
        setIsConnecting(false);
      }
    },
    [isSupported]
  );

  return {
    isSupported,
    isConnecting,
    error,
    ensureLedgerDevice, // ✅ NEW
    connectLedgerUsb,
    scanAccounts,
    setSelectedPath,
  };
}