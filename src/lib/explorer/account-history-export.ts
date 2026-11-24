import { ATOM, assetLabel } from "@/lib/networkConstants";
import { toCanonicalAddress } from "@/lib/wallet/address";

export type TxDirectionFilter = "all" | "sent" | "received";

export type TxResolvedDirection = "sent" | "received" | "self" | "unknown";

export type AccountHistoryExportFormat = "csv" | "json";

export interface AccountHistoryRecord {
  /** Transaction hash / ID (ApiHistoryTx uses `tx`; other views may use `id`). */
  tx?: string;
  id?: string;
  /** Block hash or identifier. */
  block?: string;
  /** Optional numeric block height. */
  blockHeight?: number | null;
  /** Transaction kind (e.g. "coinbase" | "in" | "out" | "faucet" | "transfer"). */
  kind?: string;
  /** Signed balance delta in atoms from `/api/history` (negative = sent, positive = received). */
  delta?: number | null;
  /** Optional sender address (PRO-21 `kvnc...dag` / `tknc...dag` or 32-byte hex). */
  from?: string | null;
  /** Optional recipient address (PRO-21 `kvnc...dag` / `tknc...dag` or 32-byte hex). */
  to?: string | null;
  /** Optional amount in atoms. */
  amount?: number | string | null;
  /** Optional fee in atoms. */
  fee?: number | string | null;
  /** RFC-002 asset ID (omitted or null = native KVNC). */
  asset_id?: string | null;
  /** KVP-106 asset kind ("fungible" | "nft"). */
  asset_kind?: string | null;
  /** Optional timestamp (epoch ms or ISO string). */
  timestamp?: number | string | null;
  /** Optional execution status. */
  status?: string | null;
  /** Optional memo or note. */
  memo?: string | null;
}

export interface AccountHistoryDirectionCounts {
  all: number;
  sent: number;
  received: number;
}

export interface NormalizedExportTransaction {
  txHash: string;
  block: string;
  direction: TxResolvedDirection;
  kind: string;
  from: string | null;
  to: string | null;
  deltaAtoms: number | null;
  amountKvnc: string | null;
  asset: string;
  feeAtoms: number | string | null;
  timestamp: number | string | null;
  status: string | null;
  memo: string | null;
}

export interface AccountHistoryJsonExport {
  address: string;
  direction: TxDirectionFilter;
  exportedAt: string;
  count: number;
  transactions: NormalizedExportTransaction[];
}

export const ACCOUNT_HISTORY_CSV_HEADERS = [
  "tx_hash",
  "block",
  "direction",
  "kind",
  "from",
  "to",
  "delta_atoms",
  "amount_kvnc",
  "asset",
  "fee_atoms",
  "timestamp",
  "status",
  "memo",
] as const;

const FORMULA_INJECTION_PREFIX_RE = /^[=+\-@\t\r]/;
const CSV_NEEDS_QUOTING_RE = /[",\n\r]/;

/**
 * Normalize an address for case-insensitive / canonical PRO-21 comparison.
 * Supports `kvnc...dag`, `tknc...dag` (testnet PRO-21), and 32-byte hex addresses.
 */
export function normalizeAddressForComparison(
  address: string | null | undefined,
): string | null {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const mainnetCandidate =
    lower.length === 64 && lower.startsWith("tknc") && lower.endsWith("dag")
      ? `kvnc${lower.slice(4)}`
      : lower;

  const canonical = toCanonicalAddress(mainnetCandidate);
  return canonical ?? lower;
}

/**
 * Compare two addresses after PRO-21 / case-insensitive normalization.
 */
export function addressesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const normA = normalizeAddressForComparison(a);
  const normB = normalizeAddressForComparison(b);
  if (!normA || !normB) return false;
  return normA === normB;
}

/**
 * Classify a transaction's direction relative to the viewed account address.
 */
export function classifyTxDirection(
  tx: AccountHistoryRecord,
  viewedAddress: string,
): TxResolvedDirection {
  const hasExplicitParties =
    (typeof tx.from === "string" && tx.from.trim().length > 0) ||
    (typeof tx.to === "string" && tx.to.trim().length > 0);

  if (hasExplicitParties) {
    const isFrom = addressesEqual(tx.from, viewedAddress);
    const isTo = addressesEqual(tx.to, viewedAddress);
    if (isFrom && isTo) return "self";
    if (isFrom) return "sent";
    if (isTo) return "received";
  }

  if (typeof tx.kind === "string") {
    const k = tx.kind.trim().toLowerCase();
    if (k === "out" || k === "sent" || k === "send") return "sent";
    if (k === "in" || k === "received" || k === "receive" || k === "coinbase" || k === "faucet") {
      return "received";
    }
  }

  if (typeof tx.delta === "number" && Number.isFinite(tx.delta)) {
    if (tx.delta < 0) return "sent";
    if (tx.delta > 0) return "received";
  }

  return "unknown";
}

/**
 * Filter account transactions by direction relative to `viewedAddress`.
 */
export function filterAccountHistoryByDirection<T extends AccountHistoryRecord>(
  transactions: readonly T[],
  viewedAddress: string,
  direction: TxDirectionFilter,
): T[] {
  if (direction === "all") {
    return [...transactions];
  }
  return transactions.filter((tx) => {
    const resolved = classifyTxDirection(tx, viewedAddress);
    if (direction === "sent") {
      return resolved === "sent" || resolved === "self";
    }
    return resolved === "received" || resolved === "self";
  });
}

/**
 * Compute counts for All / Sent / Received filter tabs.
 */
export function countAccountHistoryDirections(
  transactions: readonly AccountHistoryRecord[],
  viewedAddress: string,
): AccountHistoryDirectionCounts {
  let sent = 0;
  let received = 0;
  for (const tx of transactions) {
    const resolved = classifyTxDirection(tx, viewedAddress);
    if (resolved === "sent" || resolved === "self") sent += 1;
    if (resolved === "received" || resolved === "self") received += 1;
  }
  return {
    all: transactions.length,
    sent,
    received,
  };
}

/**
 * Neutralize spreadsheet formula injection by prefixing cells that start with
 * `=`, `+`, `-`, `@`, `\t`, or `\r` with a leading single quote (`'`).
 */
export function neutralizeCsvFormula(value: string): string {
  if (value.length > 0 && FORMULA_INJECTION_PREFIX_RE.test(value)) {
    return `'${value}`;
  }
  return value;
}

/**
 * Serialize a single CSV cell using formula-injection neutralization and
 * RFC-4180 quoting.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const safe = neutralizeCsvFormula(raw);
  if (CSV_NEEDS_QUOTING_RE.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function formatKvncFromAtoms(atoms: number | string | null | undefined): string | null {
  if (atoms === null || atoms === undefined || atoms === "") return null;
  const num = typeof atoms === "number" ? atoms : Number(atoms);
  if (!Number.isFinite(num)) return null;
  const value = num / ATOM;
  return value.toFixed(9).replace(/\.?0+$/, "");
}

function normalizeRecordForExport(
  tx: AccountHistoryRecord,
  viewedAddress: string,
): NormalizedExportTransaction {
  const txHash = (tx.tx ?? tx.id ?? "").trim();
  const block =
    typeof tx.block === "string" && tx.block.trim()
      ? tx.block.trim()
      : tx.blockHeight !== null && tx.blockHeight !== undefined
        ? String(tx.blockHeight)
        : "";
  const direction = classifyTxDirection(tx, viewedAddress);
  const kind = typeof tx.kind === "string" && tx.kind.trim() ? tx.kind.trim() : direction;
  const deltaAtoms =
    typeof tx.delta === "number" && Number.isFinite(tx.delta) ? tx.delta : null;
  const amountSource = deltaAtoms !== null ? deltaAtoms : tx.amount;

  return {
    txHash,
    block,
    direction,
    kind,
    from: typeof tx.from === "string" && tx.from.trim() ? tx.from.trim() : null,
    to: typeof tx.to === "string" && tx.to.trim() ? tx.to.trim() : null,
    deltaAtoms,
    amountKvnc: formatKvncFromAtoms(amountSource),
    asset: assetLabel(tx.asset_id),
    feeAtoms: tx.fee ?? null,
    timestamp: tx.timestamp ?? null,
    status: typeof tx.status === "string" && tx.status.trim() ? tx.status.trim() : null,
    memo: typeof tx.memo === "string" ? tx.memo : null,
  };
}

/**
 * Serialize filtered account transactions into RFC-4180 CSV with formula-injection
 * neutralization on every cell.
 */
export function serializeAccountHistoryCsv(
  transactions: readonly AccountHistoryRecord[],
  viewedAddress: string,
): string {
  const headerLine = ACCOUNT_HISTORY_CSV_HEADERS.map((h) => escapeCsvCell(h)).join(",");
  if (transactions.length === 0) {
    return `${headerLine}\r\n`;
  }

  const rows = transactions.map((tx) => {
    const item = normalizeRecordForExport(tx, viewedAddress);
    const cells = [
      item.txHash,
      item.block,
      item.direction,
      item.kind,
      item.from ?? "",
      item.to ?? "",
      item.deltaAtoms ?? "",
      item.amountKvnc ?? "",
      item.asset,
      item.feeAtoms ?? "",
      item.timestamp ?? "",
      item.status ?? "",
      item.memo ?? "",
    ];
    return cells.map((cell) => escapeCsvCell(cell)).join(",");
  });

  return `${[headerLine, ...rows].join("\r\n")}\r\n`;
}

/**
 * Build a clean, structured JSON export payload for account transaction history.
 */
export function buildAccountHistoryJsonPayload(
  transactions: readonly AccountHistoryRecord[],
  viewedAddress: string,
  direction: TxDirectionFilter,
  options?: { exportedAt?: string },
): AccountHistoryJsonExport {
  const normalizedAddress =
    normalizeAddressForComparison(viewedAddress) ?? viewedAddress.trim();
  const normalizedTxs = transactions.map((tx) =>
    normalizeRecordForExport(tx, viewedAddress),
  );

  return {
    address: normalizedAddress,
    direction,
    exportedAt: options?.exportedAt ?? new Date().toISOString(),
    count: normalizedTxs.length,
    transactions: normalizedTxs,
  };
}

/**
 * Serialize account transaction history into formatted JSON text.
 */
export function serializeAccountHistoryJson(
  transactions: readonly AccountHistoryRecord[],
  viewedAddress: string,
  direction: TxDirectionFilter,
  options?: { exportedAt?: string },
): string {
  const payload = buildAccountHistoryJsonPayload(
    transactions,
    viewedAddress,
    direction,
    options,
  );
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * Build a safe download filename combining a sanitized address prefix,
 * direction filter, and file extension (`.csv` or `.json`).
 */
export function buildAccountHistoryFilename(
  address: string,
  direction: TxDirectionFilter,
  format: AccountHistoryExportFormat,
): string {
  const sanitizedAddress = address
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 12);
  const safePrefix = sanitizedAddress || "account";
  const safeDirection: TxDirectionFilter =
    direction === "sent" || direction === "received" ? direction : "all";
  const safeExt: AccountHistoryExportFormat = format === "json" ? "json" : "csv";
  return `kovanica-history-${safePrefix}-${safeDirection}.${safeExt}`;
}
