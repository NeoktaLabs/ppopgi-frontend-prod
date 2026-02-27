// src/indexer/subgraph.ts

export type LotteryStatus =
  | "FUNDING_PENDING"
  | "OPEN"
  | "DRAWING"
  | "COMPLETED"
  | "CANCELED"
  | "UNKNOWN";

export type LotteryListItem = {
  id: string; // lottery address (Bytes as hex string)

  // Canonical registry metadata
  typeId: string;
  creator: string;
  registeredAt: string;
  registryIndex: string | null;

  // Creation snapshot from Deployer event
  deployedBy: string | null;
  deployedAt: string | null;
  deployedTx: string | null;

  // Config / constants per lottery
  name: string | null;
  usdcToken: string | null;
  feeRecipient: string | null;
  entropy: string | null;
  entropyProvider: string | null;
  callbackGasLimit: string | null;
  protocolFeePercent: string | null;

  createdAt: string | null;
  deadline: string | null;
  ticketPrice: string | null;
  winningPot: string | null;
  minTickets: string | null;
  maxTickets: string | null;
  minPurchaseAmount: string | null;

  // Live state
  status: LotteryStatus;
  sold: string;
  ticketRevenue: string;

  // Drawing state
  winner: string | null;
  selectedProvider: string | null;
  entropyRequestId: string | null;
  drawingRequestedAt: string | null;
  soldAtDrawing: string | null;

  // Cancel state
  canceledAt: string | null;
  soldAtCancel: string | null;
  cancelReason: string | null;
  creatorPotRefunded: boolean | null;

  // Accounting snapshots
  totalReservedUSDC: string | null;
};

export type UserLotteryItem = {
  id: string; // `${lottery}-${user}`
  lottery: string; // lottery id (string)
  user: string;

  ticketsPurchased: string;
  usdcSpent: string;

  ticketRefundAmount: string;
  fundsClaimedAmount: string;

  updatedAt: string;
  updatedTx: string;
};

export type GlobalActivityItem = {
  type: "BUY" | "CREATE" | "WIN" | "CANCEL";
  lotteryId: string;
  lotteryName: string;
  subject: string; // buyer/creator/winner (empty allowed)
  value: string; // ticket count OR winningPot OR "0"
  timestamp: string;
  txHash: string; // unique key for UI animations
};

type FetchOpts = { signal?: AbortSignal; forceFresh?: boolean };

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v) throw new Error(`MISSING_ENV_${name}`);
  return v;
}

/** Normalize hex strings (addresses/tx hashes/bytes IDs) for safe comparisons in UI */
function normHex(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return String(v).toLowerCase();
  return v.toLowerCase();
}

// -------------------- GraphQL fetch --------------------

async function gqlFetch<T>(
  url: string,
  query: string,
  variables: Record<string, any>,
  opts: FetchOpts = {}
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.forceFresh) headers["x-force-fresh"] = "1";

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    signal: opts.signal,
  });

  const text = await res.text();

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) throw new Error(`SUBGRAPH_HTTP_ERROR_${res.status}`);
    throw new Error("SUBGRAPH_BAD_JSON");
  }

  if (!res.ok) {
    console.error("Subgraph HTTP error", res.status, json);
    throw new Error(`SUBGRAPH_HTTP_ERROR_${res.status}`);
  }

  if (json?.errors?.length) {
    console.error("Subgraph GQL error", json.errors);
    throw new Error("SUBGRAPH_GQL_ERROR");
  }

  return json.data as T;
}

// -------------------- Status mapping --------------------

function statusFromInt(s: any): LotteryStatus {
  const n = typeof s === "number" ? s : Number(s ?? -1);
  switch (n) {
    case 0:
      return "FUNDING_PENDING";
    case 1:
      return "OPEN";
    case 2:
      return "DRAWING";
    case 3:
      return "COMPLETED";
    case 4:
      return "CANCELED";
    default:
      return "UNKNOWN";
  }
}

// -------------------- Fragments --------------------

const LOTTERY_FIELDS = `
  id

  typeId
  creator
  registeredAt
  registryIndex

  deployedBy
  deployedAt
  deployedTx

  name
  usdcToken
  feeRecipient
  entropy
  entropyProvider
  callbackGasLimit
  protocolFeePercent

  createdAt
  deadline
  ticketPrice
  winningPot
  minTickets
  maxTickets
  minPurchaseAmount

  status
  sold
  ticketRevenue

  winner
  selectedProvider
  entropyRequestId
  drawingRequestedAt
  soldAtDrawing

  canceledAt
  soldAtCancel
  cancelReason
  creatorPotRefunded

  totalReservedUSDC
`;

const LOTTERY_CARD_FIELDS = `
  id
  name
  status
  creator
  feeRecipient
  winningPot
  ticketPrice
  deadline
  minTickets
  maxTickets
  sold
  ticketRevenue
  registeredAt

  # ✅ needed for Dashboard "Winner" vs "Better luck next time"
  winner

  # ✅ optional but useful for badges/UX
  canceledAt
`;

// -------------------- Normalizers --------------------

function normalizeLottery(r: any): LotteryListItem {
  return {
    ...r,
    id: normHex(r.id) as string,

    typeId: String(r.typeId ?? "0"),
    creator: (normHex(r.creator) as string) || "0x",
    registeredAt: String(r.registeredAt ?? "0"),
    registryIndex: r.registryIndex != null ? String(r.registryIndex) : null,

    deployedBy: normHex(r.deployedBy),
    deployedAt: r.deployedAt != null ? String(r.deployedAt) : null,
    deployedTx: normHex(r.deployedTx),

    name: r.name != null ? String(r.name) : null,
    usdcToken: normHex(r.usdcToken),
    feeRecipient: normHex(r.feeRecipient),
    entropy: normHex(r.entropy),
    entropyProvider: normHex(r.entropyProvider),
    callbackGasLimit: r.callbackGasLimit != null ? String(r.callbackGasLimit) : null,
    protocolFeePercent: r.protocolFeePercent != null ? String(r.protocolFeePercent) : null,

    createdAt: r.createdAt != null ? String(r.createdAt) : null,
    deadline: r.deadline != null ? String(r.deadline) : null,
    ticketPrice: r.ticketPrice != null ? String(r.ticketPrice) : null,
    winningPot: r.winningPot != null ? String(r.winningPot) : null,
    minTickets: r.minTickets != null ? String(r.minTickets) : null,
    maxTickets: r.maxTickets != null ? String(r.maxTickets) : null,
    minPurchaseAmount: r.minPurchaseAmount != null ? String(r.minPurchaseAmount) : null,

    status: statusFromInt(r.status),
    sold: String(r.sold ?? "0"),
    ticketRevenue: String(r.ticketRevenue ?? "0"),

    winner: normHex(r.winner),
    selectedProvider: normHex(r.selectedProvider),
    entropyRequestId: r.entropyRequestId != null ? String(r.entropyRequestId) : null,
    drawingRequestedAt: r.drawingRequestedAt != null ? String(r.drawingRequestedAt) : null,
    soldAtDrawing: r.soldAtDrawing != null ? String(r.soldAtDrawing) : null,

    canceledAt: r.canceledAt != null ? String(r.canceledAt) : null,
    soldAtCancel: r.soldAtCancel != null ? String(r.soldAtCancel) : null,
    cancelReason: r.cancelReason != null ? String(r.cancelReason) : null,
    creatorPotRefunded: typeof r.creatorPotRefunded === "boolean" ? r.creatorPotRefunded : null,

    totalReservedUSDC: r.totalReservedUSDC != null ? String(r.totalReservedUSDC) : null,
  };
}

function normalizeUserLottery(p: any): UserLotteryItem {
  return {
    id: normHex(p.id) as string,
    lottery: normHex(p.lottery?.id ?? p.lottery) as string, // depending on subgraph response shape
    user: normHex(p.user) as string,

    ticketsPurchased: String(p.ticketsPurchased ?? "0"),
    usdcSpent: String(p.usdcSpent ?? "0"),

    ticketRefundAmount: String(p.ticketRefundAmount ?? "0"),
    fundsClaimedAmount: String(p.fundsClaimedAmount ?? "0"),

    updatedAt: String(p.updatedAt ?? "0"),
    updatedTx: (normHex(p.updatedTx) as string) || "0x",
  };
}

// -------------------- Public API --------------------

export async function fetchLotteriesFromSubgraph(
  opts: { first?: number; skip?: number } & FetchOpts = {}
): Promise<LotteryListItem[]> {
  const url = mustEnv("VITE_SUBGRAPH_URL");
  const first = Math.min(Math.max(opts.first ?? 50, 1), 200);
  const skip = Math.max(opts.skip ?? 0, 0);

  const query = `
    query HomeLotteries($first: Int!, $skip: Int!) {
      lotteries(
        first: $first
        skip: $skip
        orderBy: registeredAt
        orderDirection: desc
      ) {
        ${LOTTERY_CARD_FIELDS}
      }
    }
  `;

  type Resp = { lotteries: any[] };
  const data = await gqlFetch<Resp>(url, query, { first, skip }, opts);
  return (data.lotteries ?? []).map(normalizeLottery);
}

export async function fetchLotteryById(id: string, opts: FetchOpts = {}): Promise<LotteryListItem | null> {
  const url = mustEnv("VITE_SUBGRAPH_URL");
  const query = `
    query LotteryById($id: Bytes!) {
      lottery(id: $id) {
        ${LOTTERY_FIELDS}
      }
    }
  `;
  type Resp = { lottery: any | null };
  const data = await gqlFetch<Resp>(url, query, { id: id.toLowerCase() }, opts);
  return data.lottery ? normalizeLottery(data.lottery) : null;
}

/**
 * ✅ Compatibility export for UI components expecting "metadata".
 * This is just a thin alias for fetchLotteryById.
 */
export async function fetchLotteryMetadata(id: string, opts: FetchOpts = {}) {
  return await fetchLotteryById(id, opts);
}

export async function fetchLotteriesByCreator(
  creator: string,
  opts: { first?: number; skip?: number } & FetchOpts = {}
): Promise<LotteryListItem[]> {
  const url = mustEnv("VITE_SUBGRAPH_URL");
  const first = Math.min(Math.max(opts.first ?? 200, 1), 1000);
  const skip = Math.max(opts.skip ?? 0, 0);

  const query = `
    query LotteriesByCreator($creator: Bytes!, $first: Int!, $skip: Int!) {
      lotteries(
        first: $first
        skip: $skip
        where: { creator: $creator }
        orderBy: registeredAt
        orderDirection: desc
      ) {
        ${LOTTERY_FIELDS}
      }
    }
  `;

  type Resp = { lotteries: any[] };
  const data = await gqlFetch<Resp>(url, query, { creator: creator.toLowerCase(), first, skip }, opts);
  return (data.lotteries ?? []).map(normalizeLottery);
}

export async function fetchLotteriesByFeeRecipient(
  feeRecipient: string,
  opts: { first?: number; skip?: number } & FetchOpts = {}
): Promise<LotteryListItem[]> {
  const url = mustEnv("VITE_SUBGRAPH_URL");
  const first = Math.min(Math.max(opts.first ?? 200, 1), 1000);
  const skip = Math.max(opts.skip ?? 0, 0);

  const query = `
    query LotteriesByFeeRecipient($feeRecipient: Bytes!, $first: Int!, $skip: Int!) {
      lotteries(
        first: $first
        skip: $skip
        where: { feeRecipient: $feeRecipient }
        orderBy: registeredAt
        orderDirection: desc
      ) {
        ${LOTTERY_FIELDS}
      }
    }
  `;

  type Resp = { lotteries: any[] };
  const data = await gqlFetch<Resp>(url, query, { feeRecipient: feeRecipient.toLowerCase(), first, skip }, opts);
  return (data.lotteries ?? []).map(normalizeLottery);
}

export async function fetchUserLotteriesByLottery(
  lotteryId: string,
  opts: { first?: number; skip?: number } & FetchOpts = {}
): Promise<UserLotteryItem[]> {
  const url = mustEnv("VITE_SUBGRAPH_URL");
  const first = Math.min(Math.max(opts.first ?? 50, 1), 1000);
  const skip = Math.max(opts.skip ?? 0, 0);

  const query = `
    query UserLotteriesByLottery($lottery: ID!, $first: Int!, $skip: Int!) {
      userLotteries(
        first: $first
        skip: $skip
        where: { lottery: $lottery }
        orderBy: ticketsPurchased
        orderDirection: desc
      ) {
        id
        lottery { id }
        user
        ticketsPurchased
        usdcSpent
        ticketRefundAmount
        fundsClaimedAmount
        updatedAt
        updatedTx
      }
    }
  `;

  type Resp = { userLotteries: any[] };
  const data = await gqlFetch<Resp>(url, query, { lottery: lotteryId.toLowerCase(), first, skip }, opts);
  return (data.userLotteries ?? []).map(normalizeUserLottery);
}

export async function fetchUserLotteriesByUser(
  user: string,
  opts: { first?: number; skip?: number } & FetchOpts = {}
): Promise<UserLotteryItem[]> {
  const url = mustEnv("VITE_SUBGRAPH_URL");
  const first = Math.min(Math.max(opts.first ?? 200, 1), 1000);
  const skip = Math.max(opts.skip ?? 0, 0);

  const query = `
    query UserLotteriesByUser($user: Bytes!, $first: Int!, $skip: Int!) {
      userLotteries(
        first: $first
        skip: $skip
        where: { user: $user }
        orderBy: updatedAt
        orderDirection: desc
      ) {
        id
        lottery { id }
        user
        ticketsPurchased
        usdcSpent
        ticketRefundAmount
        fundsClaimedAmount
        updatedAt
        updatedTx
      }
    }
  `;

  type Resp = { userLotteries: any[] };
  const data = await gqlFetch<Resp>(url, query, { user: user.toLowerCase(), first, skip }, opts);
  return (data.userLotteries ?? []).map(normalizeUserLottery);
}

/**
 * ✅ Global Activity stream from your real entities:
 * - BUY: TicketPurchaseEvent
 * - WIN: WinnerPickedEvent
 * - CANCEL: LotteryCanceledEvent
 * - CREATE: Prefer DeployerEvent(kind="LotteryDeployed"), fallback RegistryEvent(kind="LotteryRegistered")
 *
 * Note: CREATE name may be unknown depending on which source is used:
 * - DeployerEvent includes name
 * - RegistryEvent does not include name
 */
export async function fetchGlobalActivity(
  opts: { first?: number } & FetchOpts = {}
): Promise<GlobalActivityItem[]> {
  const url = mustEnv("VITE_SUBGRAPH_URL");
  const first = Math.min(Math.max(opts.first ?? 10, 1), 50);

  const query = `
    query GlobalFeed($first: Int!) {
      buys: ticketPurchaseEvents(
        first: $first
        orderBy: timestamp
        orderDirection: desc
      ) {
        lottery { id name }
        buyer
        count
        timestamp
        txHash
      }

      wins: winnerPickedEvents(
        first: $first
        orderBy: timestamp
        orderDirection: desc
      ) {
        lottery { id name winningPot }
        winner
        timestamp
        txHash
      }

      cancels: lotteryCanceledEvents(
        first: $first
        orderBy: timestamp
        orderDirection: desc
      ) {
        lottery { id name creator }
        timestamp
        txHash
      }

      # Preferred creation source (if you emit these)
      createsDeployer: deployerEvents(
        first: $first
        orderBy: timestamp
        orderDirection: desc
        where: { kind: "LotteryDeployed" }
      ) {
        lottery
        creator
        name
        winningPot
        timestamp
        txHash
      }

      # Fallback creation source
      createsRegistry: registryEvents(
        first: $first
        orderBy: timestamp
        orderDirection: desc
        where: { kind: "LotteryRegistered" }
      ) {
        lottery
        creator
        timestamp
        txHash
      }
    }
  `;

  type Resp = {
    buys: any[];
    wins: any[];
    cancels: any[];
    createsDeployer: any[];
    createsRegistry: any[];
  };

  const data = await gqlFetch<Resp>(url, query, { first }, opts);

  const buys = (data.buys ?? []).map((e) => ({
    type: "BUY" as const,
    lotteryId: normHex(e.lottery?.id) as string,
    lotteryName: String(e.lottery?.name ?? "Unknown Lottery"),
    subject: (normHex(e.buyer) as string) || "",
    value: String(e.count ?? "0"),
    timestamp: String(e.timestamp ?? "0"),
    txHash: (normHex(e.txHash) as string) || "",
  }));

  const wins = (data.wins ?? []).map((e) => ({
    type: "WIN" as const,
    lotteryId: normHex(e.lottery?.id) as string,
    lotteryName: String(e.lottery?.name ?? "Unknown Lottery"),
    subject: (normHex(e.winner) as string) || "",
    value: String(e.lottery?.winningPot ?? "0"),
    timestamp: String(e.timestamp ?? "0"),
    txHash: (normHex(e.txHash) as string) || "",
  }));

  const cancels = (data.cancels ?? []).map((e) => ({
    type: "CANCEL" as const,
    lotteryId: normHex(e.lottery?.id) as string,
    lotteryName: String(e.lottery?.name ?? "Unknown Lottery"),
    subject: normHex(e.lottery?.creator) ?? "",
    value: "0",
    timestamp: String(e.timestamp ?? "0"),
    txHash: (normHex(e.txHash) as string) || "",
  }));

  const createsDeployer = (data.createsDeployer ?? []).map((e) => ({
    type: "CREATE" as const,
    lotteryId: normHex(e.lottery) as string,
    lotteryName: String(e.name ?? "New Lottery"),
    subject: (normHex(e.creator) as string) || "",
    value: String(e.winningPot ?? "0"),
    timestamp: String(e.timestamp ?? "0"),
    txHash: (normHex(e.txHash) as string) || "",
  }));

  const createsRegistry = (data.createsRegistry ?? []).map((e) => ({
    type: "CREATE" as const,
    lotteryId: normHex(e.lottery) as string,
    lotteryName: "New Lottery",
    subject: (normHex(e.creator) as string) || "",
    value: "0",
    timestamp: String(e.timestamp ?? "0"),
    txHash: (normHex(e.txHash) as string) || "",
  }));

  // Prefer deployer creates when available (dedup by txHash if both show up)
  const createCombined = [...createsDeployer, ...createsRegistry];
  const seen = new Set<string>();
  const creates = createCombined.filter((x) => {
    const k = x.txHash || `${x.lotteryId}:${x.timestamp}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const combined = [...buys, ...creates, ...wins, ...cancels].sort(
    (a, b) => Number(b.timestamp) - Number(a.timestamp)
  );

  return combined.slice(0, first);
}