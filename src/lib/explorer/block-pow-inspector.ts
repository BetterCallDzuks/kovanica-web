/**
 * Pure extraction and formatting helpers for Kovanica Block Header & PoW Proof inspection.
 *
 * Kept dependency-free (only importing pure helpers from `./mining-metrics`) so both
 * the browser bundle and Node's native test runner (`node --test`) can import it directly.
 */

import { formatCompactDifficulty, formatDifficultyValue } from "./mining-metrics";

export type BlockPowSource = {
  target_bits?: number | string | null;
  targetBits?: number | string | null;
  difficulty?: number | string | null;
  pow_hash?: string | null;
  powHash?: string | null;
  nonce?: number | bigint | string | null;
  state_root?: string | null;
  stateRoot?: string | null;
  tx_merkle_root?: string | null;
  txMerkleRoot?: string | null;
  pow_timestamp?: number | string | null;
  powTimestamp?: number | string | null;
  timestamp_ms?: number | null;
  timestamp?: number | null;
};

export type DifficultySource = "reported" | "derived" | "unavailable";
export type PowTimestampSource = "pow_timestamp" | "block_timestamp" | "unavailable";

export type BlockPowProof = {
  targetBits: number | null;
  targetBitsHex: string;
  targetHex: string | null;
  difficulty: number | null;
  difficultyFormatted: string;
  difficultySource: DifficultySource;
  powHash: string | null;
  powHashDisplay: string;
  nonce: string | null;
  nonceDisplay: string;
  nonceHex: string | null;
  stateRoot: string | null;
  stateRootDisplay: string;
  txMerkleRoot: string | null;
  txMerkleRootDisplay: string;
  powTimestampMs: number | null;
  powTimestampIso: string;
  powTimestampSource: PowTimestampSource;
  hasAnyPowField: boolean;
  populatedCount: number;
  totalFields: number;
};

const TOTAL_POW_FIELDS = 7;

/**
 * Normalize a hex hash or root digest. Returns null when empty or absent.
 * Adds a lowercase `0x` prefix for raw hex digests of at least 16 hex characters.
 */
export function normalizeHexDigest(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return `0x${trimmed.slice(2).toLowerCase()}`;
  }
  if (/^[0-9a-f]{16,}$/i.test(trimmed)) {
    return `0x${trimmed.toLowerCase()}`;
  }
  return trimmed;
}

/**
 * Parse a positive finite difficulty from a number or numeric string.
 */
function parseExplicitDifficulty(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Format an unsigned integer nonce (including 0 and 64-bit values) into
 * decimal and hex representations.
 */
export function formatPowNonce(raw: unknown): {
  nonce: string | null;
  nonceDisplay: string;
  nonceHex: string | null;
} {
  let big: bigint | null = null;

  if (typeof raw === "bigint") {
    if (raw >= 0n) big = raw;
  } else if (typeof raw === "number") {
    if (Number.isFinite(raw) && Number.isInteger(raw) && raw >= 0) {
      big = BigInt(raw);
    }
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      big = BigInt(trimmed);
    } else if (/^\d+$/.test(trimmed)) {
      big = BigInt(trimmed);
    }
  }

  if (big === null) {
    return { nonce: null, nonceDisplay: "n/a", nonceHex: null };
  }

  const decimal = big.toString(10);
  const grouped = decimal.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const hexWidth = big > 0xffffffffn ? 16 : 8;
  const nonceHex = `0x${big.toString(16).padStart(hexWidth, "0")}`;

  return {
    nonce: decimal,
    nonceDisplay: grouped,
    nonceHex,
  };
}

/**
 * Normalize a block/PoW timestamp into Unix milliseconds.
 * Accepts Unix seconds (< 1e12), Unix milliseconds (>= 1e12), hex quantities,
 * or ISO-8601 date strings.
 */
export function normalizePowTimestampMs(raw: unknown): number | null {
  let num: number | null = null;

  if (typeof raw === "number") {
    if (Number.isFinite(raw) && raw > 0) {
      num = raw;
    }
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      const parsed = Number.parseInt(trimmed.slice(2), 16);
      if (Number.isFinite(parsed) && parsed > 0) num = parsed;
    } else if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed) && parsed > 0) num = parsed;
    } else {
      const parsed = Date.parse(trimmed);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
  }

  if (num === null) return null;
  // Heuristic: timestamps below 1e12 (~year 2001 in ms) are Unix seconds.
  const ms = num < 1e12 ? num * 1000 : num;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms);
}

/**
 * Format a Unix millisecond timestamp as an ISO-8601 UTC string.
 */
export function formatPowTimestampIso(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return "n/a";
  try {
    return new Date(ms).toISOString();
  } catch {
    return "n/a";
  }
}

/**
 * Extract and format Block Header & PoW Proof fields from a UI `Block`, raw `ApiDagBlock`,
 * or combined pair (with `apiBlock` taking precedence for RPC-level fields when both are given).
 */
export function extractBlockPowProof(
  block: BlockPowSource | null | undefined,
  apiBlock?: BlockPowSource | null,
): BlockPowProof {
  const rawTargetBits =
    apiBlock?.target_bits ??
    apiBlock?.targetBits ??
    block?.target_bits ??
    block?.targetBits ??
    null;

  const explicitDifficulty =
    parseExplicitDifficulty(apiBlock?.difficulty) ??
    parseExplicitDifficulty(block?.difficulty);

  const compact = formatCompactDifficulty(rawTargetBits, explicitDifficulty);

  const targetBits = compact?.targetBits ?? null;
  const targetBitsHex = compact?.targetBitsHex ?? "n/a";
  const targetHex = compact?.targetHex ?? null;

  const difficulty = compact?.difficulty ?? null;
  const difficultyFormatted =
    difficulty !== null ? formatDifficultyValue(difficulty) : "n/a";
  const difficultySource: DifficultySource =
    explicitDifficulty !== null
      ? "reported"
      : difficulty !== null
        ? "derived"
        : "unavailable";

  const powHash =
    normalizeHexDigest(apiBlock?.pow_hash ?? apiBlock?.powHash) ??
    normalizeHexDigest(block?.pow_hash ?? block?.powHash);

  const rawNonce =
    apiBlock?.nonce !== undefined && apiBlock?.nonce !== null
      ? apiBlock.nonce
      : block?.nonce;
  const { nonce, nonceDisplay, nonceHex } = formatPowNonce(rawNonce);

  const stateRoot =
    normalizeHexDigest(apiBlock?.state_root ?? apiBlock?.stateRoot) ??
    normalizeHexDigest(block?.state_root ?? block?.stateRoot);

  const txMerkleRoot =
    normalizeHexDigest(apiBlock?.tx_merkle_root ?? apiBlock?.txMerkleRoot) ??
    normalizeHexDigest(block?.tx_merkle_root ?? block?.txMerkleRoot);

  const explicitPowTs =
    normalizePowTimestampMs(apiBlock?.pow_timestamp ?? apiBlock?.powTimestamp) ??
    normalizePowTimestampMs(block?.pow_timestamp ?? block?.powTimestamp);
  const fallbackBlockTs =
    normalizePowTimestampMs(apiBlock?.timestamp_ms ?? apiBlock?.timestamp) ??
    normalizePowTimestampMs(block?.timestamp_ms ?? block?.timestamp);

  const powTimestampMs = explicitPowTs ?? fallbackBlockTs;
  const powTimestampSource: PowTimestampSource =
    explicitPowTs !== null
      ? "pow_timestamp"
      : fallbackBlockTs !== null
        ? "block_timestamp"
        : "unavailable";
  const powTimestampIso = formatPowTimestampIso(powTimestampMs);

  const populatedCount = [
    targetBits !== null,
    difficulty !== null,
    powHash !== null,
    nonce !== null,
    stateRoot !== null,
    txMerkleRoot !== null,
    powTimestampMs !== null,
  ].filter(Boolean).length;

  return {
    targetBits,
    targetBitsHex,
    targetHex,
    difficulty,
    difficultyFormatted,
    difficultySource,
    powHash,
    powHashDisplay: powHash ?? "n/a",
    nonce,
    nonceDisplay,
    nonceHex,
    stateRoot,
    stateRootDisplay: stateRoot ?? "n/a",
    txMerkleRoot,
    txMerkleRootDisplay: txMerkleRoot ?? "n/a",
    powTimestampMs,
    powTimestampIso,
    powTimestampSource,
    hasAnyPowField: populatedCount > 0,
    populatedCount,
    totalFields: TOTAL_POW_FIELDS,
  };
}

/**
 * Build a concise one-line summary for the collapsed drawer header.
 */
export function formatPowSummaryBadge(proof: BlockPowProof): string {
  const parts: string[] = [];
  if (proof.difficulty !== null) {
    parts.push(`Diff ${proof.difficultyFormatted}`);
  } else if (proof.targetBits !== null) {
    parts.push(`Bits ${proof.targetBitsHex}`);
  }
  if (proof.nonce !== null) {
    parts.push(`Nonce ${proof.nonceDisplay}`);
  }
  if (parts.length === 0) {
    return `${proof.populatedCount}/${proof.totalFields} fields`;
  }
  return parts.join(" · ");
}
