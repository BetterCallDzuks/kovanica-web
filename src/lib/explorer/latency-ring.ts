export const DEFAULT_LATENCY_RING_CAPACITY = 20;

export interface LatencySample {
  latencyMs: number;
  ok: boolean;
  timestampMs: number;
}

export interface LatencySummary {
  count: number;
  okCount: number;
  errorCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  lastMs: number | null;
  points: string;
}

export type SyncLagStatus = "synced" | "lagging" | "stalled" | "unknown";

export interface SyncLagClassification {
  status: SyncLagStatus;
  lagBlocks: number | null;
  label: string;
}

const SYNCED_MAX_LAG_BLOCKS = 2;
const LAGGING_MAX_LAG_BLOCKS = 20;

function normalizeCapacity(capacity: number): number {
  if (!Number.isFinite(capacity)) return DEFAULT_LATENCY_RING_CAPACITY;
  return Math.max(0, Math.floor(capacity));
}

function isValidLatency(latencyMs: number): boolean {
  return Number.isFinite(latencyMs) && latencyMs >= 0;
}

function percentileNearestRank(sortedValues: readonly number[], pct: number): number {
  const rank = Math.ceil((pct / 100) * sortedValues.length) - 1;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, rank));
  return sortedValues[idx];
}

/**
 * Immutable ring buffer append for RPC latency probe samples.
 * Filters out non-finite (NaN / Infinity) and negative latency values,
 * and caps the returned array at `capacity` most recent samples.
 */
export function pushLatencySample(
  ring: readonly LatencySample[],
  sample: LatencySample,
  capacity: number = DEFAULT_LATENCY_RING_CAPACITY,
): LatencySample[] {
  const maxCap = normalizeCapacity(capacity);
  if (maxCap === 0) return [];

  const sanitizedRing = ring.filter((entry) => isValidLatency(entry.latencyMs));

  if (!isValidLatency(sample.latencyMs)) {
    return sanitizedRing.slice(-maxCap);
  }

  const normalizedSample: LatencySample = {
    latencyMs: sample.latencyMs,
    ok: Boolean(sample.ok),
    timestampMs:
      Number.isFinite(sample.timestampMs) && sample.timestampMs >= 0
        ? Math.round(sample.timestampMs)
        : 0,
  };

  const next = [...sanitizedRing, normalizedSample];
  return next.length > maxCap ? next.slice(next.length - maxCap) : next;
}

/**
 * Computes summary latency statistics (p50, p95, max, last, ok/error counts)
 * and generates an SVG `<polyline>` `points` attribute string for the sparkline.
 */
export function summarizeLatencyRing(
  ring: readonly LatencySample[],
  width: number = 160,
  height: number = 36,
): LatencySummary {
  const valid = ring.filter((entry) => isValidLatency(entry.latencyMs));
  const count = valid.length;

  if (count === 0) {
    return {
      count: 0,
      okCount: 0,
      errorCount: 0,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
      lastMs: null,
      points: "",
    };
  }

  let okCount = 0;
  for (const sample of valid) {
    if (sample.ok) okCount += 1;
  }
  const errorCount = count - okCount;

  const sorted = valid.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const p50Ms = percentileNearestRank(sorted, 50);
  const p95Ms = percentileNearestRank(sorted, 95);
  const maxMs = sorted[sorted.length - 1];
  const lastMs = valid[valid.length - 1].latencyMs;

  const svgWidth = Number.isFinite(width) && width > 0 ? width : 160;
  const svgHeight = Number.isFinite(height) && height > 0 ? height : 36;
  const padX = Math.min(2, svgWidth * 0.05);
  const padY = Math.min(4, svgHeight * 0.15);
  const usableW = Math.max(1, svgWidth - padX * 2);
  const usableH = Math.max(1, svgHeight - padY * 2);

  let points: string;
  if (count === 1) {
    const midY = (padY + usableH / 2).toFixed(1);
    points = `${padX.toFixed(1)},${midY} ${(svgWidth - padX).toFixed(1)},${midY}`;
  } else {
    const minVal = sorted[0];
    const span = maxMs - minVal;
    points = valid
      .map((sample, index) => {
        const x = padX + (index / (count - 1)) * usableW;
        const normalized = span > 0 ? (sample.latencyMs - minVal) / span : 0.5;
        const y = padY + (1 - normalized) * usableH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  return {
    count,
    okCount,
    errorCount,
    p50Ms,
    p95Ms,
    maxMs,
    lastMs,
    points,
  };
}

/**
 * Classifies node synchronization lag against the highest observed height.
 */
export function classifySyncLag(
  localHeight: number | null | undefined,
  highestHeight: number | null | undefined,
): SyncLagClassification {
  if (
    localHeight == null ||
    highestHeight == null ||
    !Number.isFinite(localHeight) ||
    !Number.isFinite(highestHeight) ||
    localHeight < 0 ||
    highestHeight < 0
  ) {
    return {
      status: "unknown",
      lagBlocks: null,
      label: "Sync Unknown",
    };
  }

  const lagBlocks = Math.max(0, Math.floor(highestHeight) - Math.floor(localHeight));

  if (lagBlocks <= SYNCED_MAX_LAG_BLOCKS) {
    return {
      status: "synced",
      lagBlocks,
      label: lagBlocks === 0 ? "Synced" : `Synced (-${lagBlocks} blk)`,
    };
  }

  if (lagBlocks <= LAGGING_MAX_LAG_BLOCKS) {
    return {
      status: "lagging",
      lagBlocks,
      label: `Lagging (-${lagBlocks} blks)`,
    };
  }

  return {
    status: "stalled",
    lagBlocks,
    label: `Stalled (-${lagBlocks} blks)`,
  };
}
