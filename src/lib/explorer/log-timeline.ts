/**
 * Pure, dependency-free helpers for the Explorer Contract Event Log Timeline.
 *
 * Normalizes raw `kovanica_getLogs` RPC entries into a newest-first timeline,
 * validates 32-byte transaction hashes before generating safe Contract
 * Inspector deep-links, decodes recognized Bincode log payloads, and filters
 * events by topic or free-text query.
 */

import {
  decodeContractReceiptLog,
  normalizeReceiptTxHash,
  type ReceiptLogPresetId,
} from "../contracts/dry-run";
import { toCanonicalAddress } from "../wallet/address";

export const MAX_TIMELINE_ENTRIES = 50;

export interface RawTimelineLog {
  transactionHash?: unknown;
  txHash?: unknown;
  tx_hash?: unknown;
  blockNumber?: unknown;
  block_number?: unknown;
  logIndex?: unknown;
  log_index?: unknown;
  address?: unknown;
  topics?: unknown;
  data?: unknown;
}

export interface ContractTimelineEntry {
  /** Normalized 32-byte `0x` + 64 lowercase hex tx hash, or `""` if missing/invalid. */
  txHash: string;
  /** Non-negative integer block height. */
  blockNumber: number;
  /** Non-negative integer log index. */
  logIndex: number;
  /** Canonical `kvnc…dag` address when valid, otherwise trimmed raw string. */
  address: string;
  /** Non-empty topic strings emitted with the log. */
  topics: string[];
  /** Normalized `0x…` hex payload string (or `"0x"` if empty/invalid). */
  data: string;
  /** Recognized Bincode / structured payload kind when decoded. */
  decodedKind?: string;
  /** Human-readable decoded summary when a schema/decoder matched. */
  decodedSummary?: string;
  /** Safe `/explorer?tab=contracts&tx=<hash>` deep-link for valid 32-byte tx hashes. */
  inspectorUrl?: string;
}

export interface NormalizeTimelineLogsOptions {
  /** Optional topic/text filter query applied after normalization and sorting. */
  query?: string | null;
  /** Optional Bincode log decoder preset (`"auto"` by default). */
  presetId?: ReceiptLogPresetId;
  /** Optional cap on returned entries (defaults to `MAX_TIMELINE_ENTRIES`). */
  limit?: number;
}

const VALID_HEX_DATA_RE = /^(?:0[xX])?[0-9a-fA-F]*$/;

/**
 * Validate a 32-byte transaction hash and build a safe Contract Inspector
 * deep-link (`/explorer?tab=contracts&tx=<normalizedHash>`).
 *
 * Rejects empty strings, XSS payloads, query-injection strings, and any value
 * that is not strictly 64 hex characters (with optional `0x` prefix).
 */
export function buildTimelineInspectorUrl(
  txHash: unknown,
): string | undefined {
  if (typeof txHash !== "string") return undefined;
  const normalized = normalizeReceiptTxHash(txHash);
  if (!normalized.ok) return undefined;

  const params = new URLSearchParams();
  params.set("tab", "contracts");
  params.set("tx", normalized.txHash);
  return `/explorer?${params.toString()}`;
}

function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);
  }
  if (typeof value === "bigint") {
    if (value < 0n) return null;
    return value > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^0[xX][0-9a-fA-F]+$/.test(trimmed)) {
    try {
      const parsed = BigInt(trimmed);
      if (parsed < 0n) return null;
      return parsed > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER
        : Number(parsed);
    } catch {
      return null;
    }
  }

  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.min(parsed, Number.MAX_SAFE_INTEGER);
  }

  return null;
}

function normalizeLogDataHex(raw: unknown): string {
  if (typeof raw !== "string") return "0x";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "0x" || trimmed === "0X") return "0x";
  if (!VALID_HEX_DATA_RE.test(trimmed)) return "0x";
  const clean = trimmed.replace(/^0[xX]/, "").toLowerCase();
  if (clean.length === 0 || clean.length % 2 !== 0) return "0x";
  return `0x${clean}`;
}

function normalizeTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const topics: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length > 0) {
      topics.push(trimmed);
    }
  }
  return topics;
}

function normalizeLogAddress(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return toCanonicalAddress(trimmed) ?? trimmed;
}

function inferPresetFromTopics(topics: readonly string[]): ReceiptLogPresetId | null {
  const joined = topics.join(" ").toLowerCase();
  if (!joined) return null;
  if (joined.includes("token_created") || joined.includes("token_meta")) return "token_meta";
  if (joined.includes("name_register") || joined.includes("name_entry")) return "name";
  if (joined.includes("escrow")) return "escrow";
  if (joined.includes("htlc")) return "htlc";
  if (joined.includes("vault")) return "vault";
  if (joined.includes("multisig")) return "multisig";
  return null;
}

function decodeTimelinePayload(
  dataHex: string,
  topics: readonly string[],
  presetId: ReceiptLogPresetId,
): { decodedKind?: string; decodedSummary?: string } {
  if (!dataHex || dataHex === "0x") return {};

  const tryDecode = (hint: ReceiptLogPresetId) => {
    const decoded = decodeContractReceiptLog(dataHex, hint);
    const kind = decoded.record.kind;
    if (kind === "empty") return null;
    if (kind === "raw") {
      if (decoded.outputDecoded.primary.kind === "bincode_string") {
        return {
          decodedKind: "bincode_string",
          decodedSummary: decoded.summary,
        };
      }
      return null;
    }
    if (kind === "utf8" && decoded.outputDecoded.primary.kind === "json") {
      return {
        decodedKind: "json",
        decodedSummary: decoded.summary,
      };
    }
    return {
      decodedKind: kind,
      decodedSummary: decoded.summary,
    };
  };

  if (presetId !== "auto") {
    return tryDecode(presetId) ?? {};
  }

  const inferred = inferPresetFromTopics(topics);
  if (inferred) {
    const hinted = tryDecode(inferred);
    if (hinted) return hinted;
  }

  return tryDecode("auto") ?? {};
}

/**
 * Filter normalized `ContractTimelineEntry` items by topic or free-text query.
 *
 * Matches case-insensitively across topics, tx hash, contract address,
 * block number, decoded kind/summary, and raw hex data. Multi-word queries
 * require every whitespace-separated term to match.
 */
export function filterTimelineEntries(
  entries: readonly ContractTimelineEntry[],
  query: string | null | undefined,
): ContractTimelineEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const trimmed = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!trimmed) return [...entries];

  const terms = trimmed.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...entries];

  return entries.filter((entry) => {
    const haystack = [
      entry.txHash,
      entry.address,
      String(entry.blockNumber),
      String(entry.logIndex),
      ...entry.topics,
      entry.decodedKind ?? "",
      entry.decodedSummary ?? "",
      entry.data,
    ]
      .join(" ")
      .toLowerCase();

    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * Normalize raw `kovanica_getLogs` RPC entries into a sorted, decoded,
 * XSS-safe `ContractTimelineEntry[]`.
 *
 * - Sorts newest-first (`blockNumber` desc, then `logIndex` desc)
 * - Validates 32-byte `txHash` before generating `/explorer?tab=contracts&tx=<hash>`
 * - Decodes Bincode payloads when a matching schema/decoder is present
 * - Applies optional topic/text `query` filtering and result `limit`
 * - Gracefully ignores `null`, non-array, or malformed entries without throwing
 */
export function normalizeTimelineLogs(
  rawLogs: unknown,
  options?: NormalizeTimelineLogsOptions,
): ContractTimelineEntry[] {
  if (!Array.isArray(rawLogs) || rawLogs.length === 0) return [];

  const presetId: ReceiptLogPresetId = options?.presetId ?? "auto";
  const limit =
    typeof options?.limit === "number" && Number.isFinite(options.limit) && options.limit >= 0
      ? Math.floor(options.limit)
      : MAX_TIMELINE_ENTRIES;

  const normalized: Array<{ entry: ContractTimelineEntry; order: number }> = [];

  for (let i = 0; i < rawLogs.length; i += 1) {
    const raw = rawLogs[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;

    const record = raw as RawTimelineLog;
    const rawTxHash = record.transactionHash ?? record.txHash ?? record.tx_hash;
    const parsedTxHash =
      typeof rawTxHash === "string" ? normalizeReceiptTxHash(rawTxHash) : null;
    const txHash = parsedTxHash?.ok ? parsedTxHash.txHash : "";
    const inspectorUrl = txHash ? buildTimelineInspectorUrl(txHash) : undefined;

    const parsedBlock = parseNonNegativeInt(record.blockNumber ?? record.block_number);
    const parsedLogIndex = parseNonNegativeInt(record.logIndex ?? record.log_index);
    const address = normalizeLogAddress(record.address);
    const topics = normalizeTopics(record.topics);
    const data = normalizeLogDataHex(record.data);

    // Skip completely empty/meaningless objects that carry no usable log fields.
    if (
      !txHash &&
      !address &&
      topics.length === 0 &&
      data === "0x" &&
      parsedBlock === null
    ) {
      continue;
    }

    const { decodedKind, decodedSummary } = decodeTimelinePayload(data, topics, presetId);

    const entry: ContractTimelineEntry = {
      txHash,
      blockNumber: parsedBlock ?? 0,
      logIndex: parsedLogIndex ?? 0,
      address,
      topics,
      data,
      ...(decodedKind ? { decodedKind } : {}),
      ...(decodedSummary ? { decodedSummary } : {}),
      ...(inspectorUrl ? { inspectorUrl } : {}),
    };

    normalized.push({ entry, order: i });
  }

  normalized.sort((a, b) => {
    if (b.entry.blockNumber !== a.entry.blockNumber) {
      return b.entry.blockNumber - a.entry.blockNumber;
    }
    if (b.entry.logIndex !== a.entry.logIndex) {
      return b.entry.logIndex - a.entry.logIndex;
    }
    return a.order - b.order;
  });

  const sortedEntries = normalized.map((item) => item.entry);
  const filtered = filterTimelineEntries(sortedEntries, options?.query);
  return limit < filtered.length ? filtered.slice(0, limit) : filtered;
}
