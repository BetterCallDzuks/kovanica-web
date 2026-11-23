/**
 * Pure calculation and formatting helpers for Kovanica Mining & DAG Telemetry.
 *
 * Kept dependency-free and erasable-TypeScript-only so both the browser bundle
 * and Node's native test runner (`node --test`) can import it directly.
 */

export const BLOCKS_PER_ERA = 8_200_000;
export const INITIAL_BLOCK_REWARD_KVNC = 2.5;
export const ERA_DECAY_NUMERATOR = 3;
export const ERA_DECAY_DENOMINATOR = 4;
export const MAX_MINING_SUBSIDY_KVNC = 82_000_000;
export const TARGET_BLOCK_INTERVAL_MS = 4_000;
export const TARGET_BLOCK_INTERVAL_SEC = 4.0;

/** Bitcoin-style difficulty-1 compact target (0x1d00ffff). */
const DIFFICULTY_1_MANTISSA = 0x00ffff;
const DIFFICULTY_1_EXPONENT = 0x1d;
const DIFFICULTY_1_TARGET = DIFFICULTY_1_MANTISSA * 2 ** (8 * (DIFFICULTY_1_EXPONENT - 3));

export type EmissionEraInfo = {
  era: number;
  height: number;
  blocksPerEra: number;
  blockInEra: number;
  blocksRemaining: number;
  progressPct: number;
  rewardKvnc: number;
  nextEraRewardKvnc: number;
  eraStartHeight: number;
  eraEndHeight: number;
};

export type CompactDifficultyInfo = {
  targetBits: number | null;
  targetBitsHex: string | null;
  exponent: number | null;
  mantissa: number | null;
  targetHex: string | null;
  difficulty: number | null;
  difficultyFormatted: string;
};

export type ObservedIntervalStatus = "fast" | "on-target" | "slow";

export type ObservedIntervalInfo = {
  avgIntervalMs: number;
  avgIntervalSec: number;
  sampleCount: number;
  deltaFromTargetMs: number;
  status: ObservedIntervalStatus;
};

/**
 * Compute NoStake82M emission era state for a given block height.
 *
 * Reward schedule: 2.5 * (3/4)^era KVNC per block, with 8,200,000 blocks/era.
 * Geometric sum across all eras: 2.5 * 8,200,000 / (1 - 3/4) = 82,000,000 KVNC.
 *
 * Returns null when height is unavailable or invalid (never fakes height 0).
 */
export function computeEmissionEra(height: number | null | undefined): EmissionEraInfo | null {
  if (typeof height !== "number" || !Number.isFinite(height) || height < 0) {
    return null;
  }

  const safeHeight = Math.floor(height);
  const era = Math.floor(safeHeight / BLOCKS_PER_ERA);
  const blockInEra = safeHeight % BLOCKS_PER_ERA;
  const blocksRemaining = BLOCKS_PER_ERA - blockInEra;
  const progressPct = (blockInEra / BLOCKS_PER_ERA) * 100;
  const ratio = ERA_DECAY_NUMERATOR / ERA_DECAY_DENOMINATOR;
  const rewardKvnc = INITIAL_BLOCK_REWARD_KVNC * Math.pow(ratio, era);
  const nextEraRewardKvnc = INITIAL_BLOCK_REWARD_KVNC * Math.pow(ratio, era + 1);

  return {
    era,
    height: safeHeight,
    blocksPerEra: BLOCKS_PER_ERA,
    blockInEra,
    blocksRemaining,
    progressPct,
    rewardKvnc,
    nextEraRewardKvnc,
    eraStartHeight: era * BLOCKS_PER_ERA,
    eraEndHeight: (era + 1) * BLOCKS_PER_ERA,
  };
}

/**
 * Format a KVNC block reward with clean precision (no trailing noise).
 */
export function formatKvncReward(kvnc: number | null | undefined): string {
  if (typeof kvnc !== "number" || !Number.isFinite(kvnc) || kvnc < 0) {
    return "n/a";
  }
  if (kvnc === 0) return "0 KVNC";
  const decimals = kvnc >= 1 ? 4 : kvnc >= 0.01 ? 6 : 8;
  const trimmed = kvnc.toFixed(decimals).replace(/\.?0+$/, "");
  return `${trimmed} KVNC`;
}

/**
 * Parse compact `target_bits` from a number or hex/decimal string.
 * Returns null when absent or out of uint32 range.
 */
export function parseTargetBits(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0 || raw > 0xffffffff) {
      return null;
    }
    return raw >>> 0;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    let parsed: number;
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      parsed = Number.parseInt(trimmed.slice(2), 16);
    } else if (/^\d+$/.test(trimmed)) {
      parsed = Number.parseInt(trimmed, 10);
    } else if (/^[0-9a-f]{8}$/i.test(trimmed)) {
      parsed = Number.parseInt(trimmed, 16);
    } else {
      return null;
    }
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffffffff) {
      return null;
    }
    return parsed >>> 0;
  }

  return null;
}

/**
 * Format a numeric PoW difficulty with SI suffixes for large values and
 * appropriate precision for small testnet difficulties.
 */
export function formatDifficultyValue(difficulty: number | null | undefined): string {
  if (typeof difficulty !== "number" || !Number.isFinite(difficulty) || difficulty <= 0) {
    return "n/a";
  }
  if (difficulty >= 1e12) return `${(difficulty / 1e12).toFixed(2)} T`;
  if (difficulty >= 1e9) return `${(difficulty / 1e9).toFixed(2)} G`;
  if (difficulty >= 1e6) return `${(difficulty / 1e6).toFixed(2)} M`;
  if (difficulty >= 1e3) return `${(difficulty / 1e3).toFixed(2)} K`;
  if (difficulty >= 1) return difficulty.toFixed(2);
  if (difficulty >= 0.001) return difficulty.toFixed(4);
  return difficulty.toExponential(2);
}

/**
 * Decode compact `target_bits` (nBits) into hex target and difficulty display.
 *
 * When `explicitDifficulty` is reported by the node (e.g. `kovanica_getMiningInfo`),
 * it is preferred over the compact-target estimate. Returns null if neither
 * `targetBits` nor a positive `explicitDifficulty` is available.
 */
export function formatCompactDifficulty(
  targetBits: number | string | null | undefined,
  explicitDifficulty?: number | null,
): CompactDifficultyInfo | null {
  const bits = parseTargetBits(targetBits);
  const hasExplicit =
    typeof explicitDifficulty === "number" &&
    Number.isFinite(explicitDifficulty) &&
    explicitDifficulty > 0;

  if (bits === null) {
    if (!hasExplicit) return null;
    return {
      targetBits: null,
      targetBitsHex: null,
      exponent: null,
      mantissa: null,
      targetHex: null,
      difficulty: explicitDifficulty,
      difficultyFormatted: formatDifficultyValue(explicitDifficulty),
    };
  }

  const targetBitsHex = `0x${bits.toString(16).padStart(8, "0")}`;
  const exponent = (bits >>> 24) & 0xff;
  const isNegative = (bits & 0x00800000) !== 0;
  const mantissa = bits & 0x007fffff;

  let targetHex: string | null = null;
  let derivedDifficulty: number | null = null;

  if (!isNegative && exponent > 0 && mantissa > 0) {
    const targetBig =
      exponent <= 3
        ? BigInt(mantissa) >> BigInt(8 * (3 - exponent))
        : BigInt(mantissa) << BigInt(8 * (exponent - 3));
    if (targetBig > 0n) {
      const hex = targetBig.toString(16);
      targetHex = `0x${hex.length <= 64 ? hex.padStart(64, "0") : hex}`;
      const targetNum = mantissa * 2 ** (8 * (exponent - 3));
      if (Number.isFinite(targetNum) && targetNum > 0) {
        derivedDifficulty = DIFFICULTY_1_TARGET / targetNum;
      }
    }
  }

  const difficulty = hasExplicit ? explicitDifficulty : derivedDifficulty;

  return {
    targetBits: bits,
    targetBitsHex,
    exponent,
    mantissa,
    targetHex,
    difficulty,
    difficultyFormatted: formatDifficultyValue(difficulty),
  };
}

/**
 * Compute observed mean block interval from recent block timestamps (ms).
 *
 * Returns null if fewer than 2 valid timestamps exist or the time span is
 * non-positive (never fakes 0.0s).
 */
export function computeObservedBlockInterval(
  timestampsMs: readonly number[],
  targetIntervalMs = TARGET_BLOCK_INTERVAL_MS,
): ObservedIntervalInfo | null {
  const valid = timestampsMs
    .filter((t) => typeof t === "number" && Number.isFinite(t) && t > 0)
    .sort((a, b) => a - b);

  if (valid.length < 2) return null;

  const spanMs = valid[valid.length - 1] - valid[0];
  if (spanMs <= 0) return null;

  const avgIntervalMs = spanMs / (valid.length - 1);
  const avgIntervalSec = avgIntervalMs / 1000;
  const deltaFromTargetMs = avgIntervalMs - targetIntervalMs;
  const tolerance = targetIntervalMs * 0.15;

  const status: ObservedIntervalStatus =
    avgIntervalMs < targetIntervalMs - tolerance
      ? "fast"
      : avgIntervalMs > targetIntervalMs + tolerance
        ? "slow"
        : "on-target";

  return {
    avgIntervalMs,
    avgIntervalSec,
    sampleCount: valid.length,
    deltaFromTargetMs,
    status,
  };
}
