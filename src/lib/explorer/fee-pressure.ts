/**
 * Pure, dependency-free fee-rate pressure classification and 1.2x buffered fee
 * helpers for the Kovanica Explorer Live DAG & Mempool Stream drawer.
 */

export type FeePressureTier = "low" | "normal" | "elevated" | "congested" | "unknown";

export interface FeePressureSummary {
  tier: FeePressureTier;
  label: string;
  baseFeeAtomsPerByte: bigint | null;
  bufferedFeeAtomsPerByte: bigint | null;
  pendingTxCount: number | null;
  formattedBaseFee: string;
  formattedBufferedFee: string;
}

export const DEFAULT_FEE_SAFETY_MULTIPLIER_BPS = 12_000;

const BPS_DENOMINATOR = 10_000n;

const FEE_RATE_LOW_MAX_ATOMS = 5_000n;
const FEE_RATE_NORMAL_MAX_ATOMS = 25_000n;
const FEE_RATE_ELEVATED_MAX_ATOMS = 100_000n;

const MEMPOOL_NORMAL_MIN_TX = 20;
const MEMPOOL_ELEVATED_MIN_TX = 100;
const MEMPOOL_CONGESTED_MIN_TX = 500;

const TIER_RANK: Record<Exclude<FeePressureTier, "unknown">, number> = {
  low: 0,
  normal: 1,
  elevated: 2,
  congested: 3,
};

const TIER_LABEL: Record<FeePressureTier, string> = {
  low: "Low",
  normal: "Normal",
  elevated: "Elevated",
  congested: "Congested",
  unknown: "Unknown",
};

function parseFeeRateAtoms(
  value: bigint | number | string | null | undefined,
): bigint | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "bigint") {
    return value >= 0n ? value : null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    if (Number.isInteger(value)) {
      return Number.isSafeInteger(value) ? BigInt(value) : null;
    }
    const ceiled = Math.ceil(value);
    return Number.isSafeInteger(ceiled) ? BigInt(ceiled) : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (/^0x[0-9a-fA-F]+$/.test(trimmed) || /^[0-9]+$/.test(trimmed)) {
      try {
        const parsed = BigInt(trimmed);
        return parsed >= 0n ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  return null;
}

function normalizePendingTxCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function formatFeeAtomsPerByte(atoms: bigint | null): string {
  if (atoms === null) return "n/a";
  const grouped = atoms.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped} atoms/B`;
}

function classifyByFeeRate(
  baseFeeAtoms: bigint,
): Exclude<FeePressureTier, "unknown"> {
  if (baseFeeAtoms <= FEE_RATE_LOW_MAX_ATOMS) return "low";
  if (baseFeeAtoms <= FEE_RATE_NORMAL_MAX_ATOMS) return "normal";
  if (baseFeeAtoms <= FEE_RATE_ELEVATED_MAX_ATOMS) return "elevated";
  return "congested";
}

function classifyByPendingTxCount(
  pendingTxCount: number | null,
): Exclude<FeePressureTier, "unknown"> {
  if (pendingTxCount === null || pendingTxCount < MEMPOOL_NORMAL_MIN_TX) return "low";
  if (pendingTxCount < MEMPOOL_ELEVATED_MIN_TX) return "normal";
  if (pendingTxCount < MEMPOOL_CONGESTED_MIN_TX) return "elevated";
  return "congested";
}

/**
 * Compute a safety-buffered fee rate in atoms using exact ceiling BigInt math.
 *
 * Defaults to a 1.2x safety buffer (`safetyMultiplierBps = 12_000`, i.e. 120%).
 * Rejects negative `baseFeeAtoms` or invalid/negative `safetyMultiplierBps`.
 */
export function computeBufferedFeeAtoms(
  baseFeeAtoms: bigint,
  safetyMultiplierBps = DEFAULT_FEE_SAFETY_MULTIPLIER_BPS,
): bigint {
  if (typeof baseFeeAtoms !== "bigint") {
    throw new TypeError("baseFeeAtoms must be a bigint");
  }
  if (baseFeeAtoms < 0n) {
    throw new RangeError("baseFeeAtoms must be non-negative");
  }
  if (
    typeof safetyMultiplierBps !== "number" ||
    !Number.isFinite(safetyMultiplierBps) ||
    !Number.isInteger(safetyMultiplierBps) ||
    safetyMultiplierBps < 0
  ) {
    throw new RangeError("safetyMultiplierBps must be a non-negative integer");
  }

  if (baseFeeAtoms === 0n || safetyMultiplierBps === 0) {
    return 0n;
  }

  const multiplier = BigInt(safetyMultiplierBps);
  return (baseFeeAtoms * multiplier + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

/**
 * Classify live mempool & fee-rate pressure and compute the recommended
 * 1.2x buffered fee rate.
 *
 * Returns a safe `"unknown"` summary when fee rate data is missing or invalid.
 */
export function classifyFeePressure(
  feeRateAtomsPerByte: bigint | number | string | null | undefined,
  pendingTxCount?: number | null,
): FeePressureSummary {
  const baseFeeAtomsPerByte = parseFeeRateAtoms(feeRateAtomsPerByte);
  const normalizedPending = normalizePendingTxCount(pendingTxCount);

  if (baseFeeAtomsPerByte === null) {
    return {
      tier: "unknown",
      label: TIER_LABEL.unknown,
      baseFeeAtomsPerByte: null,
      bufferedFeeAtomsPerByte: null,
      pendingTxCount: normalizedPending,
      formattedBaseFee: formatFeeAtomsPerByte(null),
      formattedBufferedFee: formatFeeAtomsPerByte(null),
    };
  }

  const bufferedFeeAtomsPerByte = computeBufferedFeeAtoms(baseFeeAtomsPerByte);
  const feeTier = classifyByFeeRate(baseFeeAtomsPerByte);
  const mempoolTier = classifyByPendingTxCount(normalizedPending);
  const tier = TIER_RANK[mempoolTier] > TIER_RANK[feeTier] ? mempoolTier : feeTier;

  return {
    tier,
    label: TIER_LABEL[tier],
    baseFeeAtomsPerByte,
    bufferedFeeAtomsPerByte,
    pendingTxCount: normalizedPending,
    formattedBaseFee: formatFeeAtomsPerByte(baseFeeAtomsPerByte),
    formattedBufferedFee: formatFeeAtomsPerByte(bufferedFeeAtomsPerByte),
  };
}
