/**
 * Pure normalizers and status evaluators for the Kovanica Ecosystem Services
 * Health Matrix on `/network`.
 *
 * Covers the four canonical ecosystem service probes:
 *   1. RPC Node `/health` (`rpc_version`, `mempool_pending`, `status`, `height`)
 *   2. Indexer `/integrity` (`ok`, `total_events`, `checked_at_ms`)
 *   3. Stratum Gateway `/workers` (`worker_count`, `summary.{min,median,max}_difficulty`, `summary.stale_ratio`)
 *   4. Comms Relay `/v1/health` (`status`, `queued_envelopes`, `active_mailboxes`)
 */

export type EcosystemServiceStatus = "healthy" | "degraded" | "offline";

export type EcosystemServiceId = "rpc" | "indexer" | "stratum" | "comms";

export interface EcosystemMetric {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}

export interface EcosystemServiceCard {
  readonly id: EcosystemServiceId;
  readonly name: string;
  readonly endpoint: string;
  readonly status: EcosystemServiceStatus;
  readonly summary: string;
  readonly metrics: readonly EcosystemMetric[];
  readonly detail?: string;
}

export interface RpcHealthNormalized {
  readonly status: EcosystemServiceStatus;
  readonly rawStatus: string | null;
  readonly rpcVersion: string | null;
  readonly mempoolPending: number | null;
  readonly height: number | null;
  readonly detail?: string;
}

export interface IndexerIntegrityNormalized {
  readonly status: EcosystemServiceStatus;
  readonly ok: boolean | null;
  readonly totalEvents: number | null;
  readonly checkedAtMs: number | null;
  readonly detail?: string;
}

export interface StratumWorkersNormalized {
  readonly status: EcosystemServiceStatus;
  readonly workerCount: number | null;
  readonly minDifficulty: number | null;
  readonly medianDifficulty: number | null;
  readonly maxDifficulty: number | null;
  readonly staleRatio: number | null;
  readonly staleRatioLabel: string;
  readonly detail?: string;
}

export interface CommsRelayHealthNormalized {
  readonly status: EcosystemServiceStatus;
  readonly rawStatus: string | null;
  readonly queuedEnvelopes: number | null;
  readonly activeMailboxes: number | null;
  readonly detail?: string;
}

export interface EcosystemServiceProbeInput {
  readonly payload?: unknown;
  readonly error?: string | null;
}

export interface EcosystemHealthMatrixInput {
  readonly rpc?: EcosystemServiceProbeInput | null;
  readonly indexer?: EcosystemServiceProbeInput | null;
  readonly stratum?: EcosystemServiceProbeInput | null;
  readonly comms?: EcosystemServiceProbeInput | null;
}

export interface EcosystemHealthMatrix {
  readonly overall: EcosystemServiceStatus;
  readonly healthyCount: number;
  readonly degradedCount: number;
  readonly offlineCount: number;
  readonly totalCount: number;
  readonly services: readonly EcosystemServiceCard[];
  readonly rpc: RpcHealthNormalized;
  readonly indexer: IndexerIntegrityNormalized;
  readonly stratum: StratumWorkersNormalized;
  readonly comms: CommsRelayHealthNormalized;
}

const ELEVATED_STALE_RATIO_THRESHOLD = 0.1;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function asNonNegativeInt(value: unknown): number | null {
  const num = asNonNegativeNumber(value);
  return num === null ? null : Math.floor(num);
}

function parseServiceStatusKeyword(raw: string | null): EcosystemServiceStatus | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (
    normalized === "ok" ||
    normalized === "healthy" ||
    normalized === "live" ||
    normalized === "operational" ||
    normalized === "up"
  ) {
    return "healthy";
  }
  if (
    normalized === "degraded" ||
    normalized === "syncing" ||
    normalized === "stalled" ||
    normalized === "catching_up" ||
    normalized === "backlogged" ||
    normalized === "draining" ||
    normalized === "warning" ||
    normalized === "warn"
  ) {
    return "degraded";
  }
  if (
    normalized === "offline" ||
    normalized === "down" ||
    normalized === "error" ||
    normalized === "unhealthy" ||
    normalized === "failed"
  ) {
    return "offline";
  }
  return null;
}

function formatInt(value: number | null): string {
  return value === null ? "n/a" : value.toLocaleString("en-US");
}

function formatDifficulty(value: number | null): string {
  if (value === null) return "n/a";
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Formats a Stratum stale share ratio (0..1) as a one-decimal percentage string.
 * Out-of-range ratios above 1 are clamped to 100.0%; negative or non-finite values return "n/a".
 */
export function formatStaleRatio(ratio: number | null | undefined): string {
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0) {
    return "n/a";
  }
  const clamped = Math.min(1, ratio);
  return `${(clamped * 100).toFixed(1)}%`;
}

/** Formats min / median / max difficulty into a compact summary string. */
export function formatDifficultyRange(
  min: number | null,
  median: number | null,
  max: number | null,
): string {
  if (min === null && median === null && max === null) return "n/a";
  return `${formatDifficulty(min)} / ${formatDifficulty(median)} / ${formatDifficulty(max)}`;
}

/** Formats an epoch millisecond timestamp as an ISO UTC clock string (HH:MM:SS UTC) or "n/a". */
export function formatCheckedAtMs(checkedAtMs: number | null): string {
  if (checkedAtMs === null || !Number.isFinite(checkedAtMs) || checkedAtMs <= 0) {
    return "n/a";
  }
  const date = new Date(checkedAtMs);
  if (Number.isNaN(date.getTime())) return "n/a";
  return `${date.toISOString().slice(11, 19)} UTC`;
}

/** Normalizes an RPC Node `/health` payload into a typed status object. */
export function normalizeRpcHealth(
  payload: unknown,
  error?: string | null,
): RpcHealthNormalized {
  const errText = asNonEmptyString(error);
  if (errText) {
    return {
      status: "offline",
      rawStatus: null,
      rpcVersion: null,
      mempoolPending: null,
      height: null,
      detail: errText,
    };
  }

  const record = asRecord(payload);
  if (!record) {
    return {
      status: "offline",
      rawStatus: null,
      rpcVersion: null,
      mempoolPending: null,
      height: null,
      detail: "Unreachable or malformed RPC health payload",
    };
  }

  const rawStatus = asNonEmptyString(record.status);
  const rpcVersion = asNonEmptyString(record.rpc_version);
  const mempoolPending = asNonNegativeInt(record.mempool_pending);
  const height = asNonNegativeInt(record.height);
  const parsedStatus = parseServiceStatusKeyword(rawStatus);

  if (parsedStatus) {
    return {
      status: parsedStatus,
      rawStatus,
      rpcVersion,
      mempoolPending,
      height,
      detail:
        parsedStatus === "healthy"
          ? undefined
          : `RPC reported status "${rawStatus}"`,
    };
  }

  if (height !== null || rpcVersion !== null || mempoolPending !== null) {
    return {
      status: "degraded",
      rawStatus,
      rpcVersion,
      mempoolPending,
      height,
      detail: rawStatus
        ? `Unrecognized RPC status "${rawStatus}"`
        : "Missing RPC status field",
    };
  }

  return {
    status: "offline",
    rawStatus,
    rpcVersion: null,
    mempoolPending: null,
    height: null,
    detail: "Malformed RPC health payload",
  };
}

/** Normalizes an Indexer `/integrity` payload into a typed status object. */
export function normalizeIndexerIntegrity(
  payload: unknown,
  error?: string | null,
): IndexerIntegrityNormalized {
  const errText = asNonEmptyString(error);
  if (errText) {
    return {
      status: "offline",
      ok: null,
      totalEvents: null,
      checkedAtMs: null,
      detail: errText,
    };
  }

  const record = asRecord(payload);
  if (!record) {
    return {
      status: "offline",
      ok: null,
      totalEvents: null,
      checkedAtMs: null,
      detail: "Unreachable or malformed indexer integrity payload",
    };
  }

  const ok = typeof record.ok === "boolean" ? record.ok : null;
  const totalEvents = asNonNegativeInt(record.total_events);
  const checkedAtMs = asNonNegativeInt(record.checked_at_ms);

  if (ok === true) {
    return {
      status: "healthy",
      ok,
      totalEvents,
      checkedAtMs,
    };
  }

  if (ok === false) {
    return {
      status: "degraded",
      ok,
      totalEvents,
      checkedAtMs,
      detail: "Integrity check reported mismatch",
    };
  }

  if (totalEvents !== null || checkedAtMs !== null) {
    return {
      status: "degraded",
      ok: null,
      totalEvents,
      checkedAtMs,
      detail: "Missing integrity ok flag",
    };
  }

  return {
    status: "offline",
    ok: null,
    totalEvents: null,
    checkedAtMs: null,
    detail: "Malformed indexer integrity payload",
  };
}

/** Normalizes a Stratum Gateway `/workers` payload into a typed status object. */
export function normalizeStratumWorkers(
  payload: unknown,
  error?: string | null,
): StratumWorkersNormalized {
  const errText = asNonEmptyString(error);
  if (errText) {
    return {
      status: "offline",
      workerCount: null,
      minDifficulty: null,
      medianDifficulty: null,
      maxDifficulty: null,
      staleRatio: null,
      staleRatioLabel: "n/a",
      detail: errText,
    };
  }

  const record = asRecord(payload);
  if (!record) {
    return {
      status: "offline",
      workerCount: null,
      minDifficulty: null,
      medianDifficulty: null,
      maxDifficulty: null,
      staleRatio: null,
      staleRatioLabel: "n/a",
      detail: "Unreachable or malformed Stratum workers payload",
    };
  }

  const workerCount = asNonNegativeInt(record.worker_count);
  const summary = asRecord(record.summary);
  const minDifficulty = asNonNegativeNumber(summary?.min_difficulty);
  const medianDifficulty = asNonNegativeNumber(summary?.median_difficulty);
  const maxDifficulty = asNonNegativeNumber(summary?.max_difficulty);
  const staleRatio = asNonNegativeNumber(summary?.stale_ratio);
  const staleRatioLabel = formatStaleRatio(staleRatio);

  const hasSummaryMetric =
    minDifficulty !== null ||
    medianDifficulty !== null ||
    maxDifficulty !== null ||
    staleRatio !== null;

  if (workerCount === null && !hasSummaryMetric) {
    return {
      status: "offline",
      workerCount: null,
      minDifficulty: null,
      medianDifficulty: null,
      maxDifficulty: null,
      staleRatio: null,
      staleRatioLabel: "n/a",
      detail: "Malformed Stratum workers payload",
    };
  }

  if (staleRatio !== null && staleRatio > ELEVATED_STALE_RATIO_THRESHOLD) {
    return {
      status: "degraded",
      workerCount,
      minDifficulty,
      medianDifficulty,
      maxDifficulty,
      staleRatio,
      staleRatioLabel,
      detail: `Elevated stale share ratio (${staleRatioLabel})`,
    };
  }

  if (workerCount === null) {
    return {
      status: "degraded",
      workerCount: null,
      minDifficulty,
      medianDifficulty,
      maxDifficulty,
      staleRatio,
      staleRatioLabel,
      detail: "Missing worker_count field",
    };
  }

  return {
    status: "healthy",
    workerCount,
    minDifficulty,
    medianDifficulty,
    maxDifficulty,
    staleRatio,
    staleRatioLabel,
  };
}

/** Normalizes a Comms Relay `/v1/health` payload into a typed status object. */
export function normalizeCommsRelayHealth(
  payload: unknown,
  error?: string | null,
): CommsRelayHealthNormalized {
  const errText = asNonEmptyString(error);
  if (errText) {
    return {
      status: "offline",
      rawStatus: null,
      queuedEnvelopes: null,
      activeMailboxes: null,
      detail: errText,
    };
  }

  const record = asRecord(payload);
  if (!record) {
    return {
      status: "offline",
      rawStatus: null,
      queuedEnvelopes: null,
      activeMailboxes: null,
      detail: "Unreachable or malformed Comms Relay health payload",
    };
  }

  const rawStatus = asNonEmptyString(record.status);
  const queuedEnvelopes = asNonNegativeInt(record.queued_envelopes);
  const activeMailboxes = asNonNegativeInt(record.active_mailboxes);
  const parsedStatus = parseServiceStatusKeyword(rawStatus);

  if (parsedStatus) {
    return {
      status: parsedStatus,
      rawStatus,
      queuedEnvelopes,
      activeMailboxes,
      detail:
        parsedStatus === "healthy"
          ? undefined
          : `Comms Relay reported status "${rawStatus}"`,
    };
  }

  if (queuedEnvelopes !== null || activeMailboxes !== null) {
    return {
      status: "degraded",
      rawStatus,
      queuedEnvelopes,
      activeMailboxes,
      detail: rawStatus
        ? `Unrecognized relay status "${rawStatus}"`
        : "Missing relay status field",
    };
  }

  return {
    status: "offline",
    rawStatus,
    queuedEnvelopes: null,
    activeMailboxes: null,
    detail: "Malformed Comms Relay health payload",
  };
}

/**
 * Evaluates all four ecosystem service probes into a unified health matrix.
 *
 * Overall status rules:
 *   - `"healthy"` when all 4 services are `"healthy"`
 *   - `"offline"` when all 4 services are `"offline"`
 *   - `"degraded"` for any mixed or partially degraded/offline state
 */
export function evaluateEcosystemHealthMatrix(
  input?: EcosystemHealthMatrixInput | null,
): EcosystemHealthMatrix {
  const rpc = normalizeRpcHealth(input?.rpc?.payload, input?.rpc?.error);
  const indexer = normalizeIndexerIntegrity(input?.indexer?.payload, input?.indexer?.error);
  const stratum = normalizeStratumWorkers(input?.stratum?.payload, input?.stratum?.error);
  const comms = normalizeCommsRelayHealth(input?.comms?.payload, input?.comms?.error);

  const services: EcosystemServiceCard[] = [
    {
      id: "rpc",
      name: "RPC Node",
      endpoint: "/health",
      status: rpc.status,
      summary:
        rpc.height !== null
          ? `Height ${formatInt(rpc.height)}`
          : rpc.status === "offline"
            ? "Unavailable"
            : "Partial telemetry",
      metrics: [
        { label: "Height", value: formatInt(rpc.height), mono: true },
        { label: "RPC Version", value: rpc.rpcVersion ?? "n/a", mono: true },
        { label: "Mempool Pending", value: formatInt(rpc.mempoolPending), mono: true },
      ],
      detail: rpc.detail,
    },
    {
      id: "indexer",
      name: "Indexer",
      endpoint: "/integrity",
      status: indexer.status,
      summary:
        indexer.ok === true
          ? "Integrity verified"
          : indexer.ok === false
            ? "Integrity mismatch"
            : indexer.status === "offline"
              ? "Unavailable"
              : "Integrity unknown",
      metrics: [
        {
          label: "Integrity",
          value: indexer.ok === null ? "n/a" : indexer.ok ? "OK" : "Mismatch",
          mono: true,
        },
        { label: "Total Events", value: formatInt(indexer.totalEvents), mono: true },
        { label: "Checked At", value: formatCheckedAtMs(indexer.checkedAtMs), mono: true },
      ],
      detail: indexer.detail,
    },
    {
      id: "stratum",
      name: "Stratum Gateway",
      endpoint: "/workers",
      status: stratum.status,
      summary:
        stratum.workerCount !== null
          ? `${formatInt(stratum.workerCount)} active worker${stratum.workerCount === 1 ? "" : "s"}`
          : stratum.status === "offline"
            ? "Unavailable"
            : "Partial telemetry",
      metrics: [
        { label: "Workers", value: formatInt(stratum.workerCount), mono: true },
        {
          label: "Diff (min / med / max)",
          value: formatDifficultyRange(
            stratum.minDifficulty,
            stratum.medianDifficulty,
            stratum.maxDifficulty,
          ),
          mono: true,
        },
        { label: "Stale Ratio", value: stratum.staleRatioLabel, mono: true },
      ],
      detail: stratum.detail,
    },
    {
      id: "comms",
      name: "Comms Relay",
      endpoint: "/v1/health",
      status: comms.status,
      summary:
        comms.activeMailboxes !== null
          ? `${formatInt(comms.activeMailboxes)} active mailbox${comms.activeMailboxes === 1 ? "" : "es"}`
          : comms.status === "offline"
            ? "Unavailable"
            : "Partial telemetry",
      metrics: [
        { label: "Relay Status", value: comms.rawStatus ?? "n/a", mono: true },
        { label: "Queued Envelopes", value: formatInt(comms.queuedEnvelopes), mono: true },
        { label: "Active Mailboxes", value: formatInt(comms.activeMailboxes), mono: true },
      ],
      detail: comms.detail,
    },
  ];

  let healthyCount = 0;
  let degradedCount = 0;
  let offlineCount = 0;
  for (const service of services) {
    if (service.status === "healthy") healthyCount += 1;
    else if (service.status === "degraded") degradedCount += 1;
    else offlineCount += 1;
  }

  const totalCount = services.length;
  const overall: EcosystemServiceStatus =
    healthyCount === totalCount
      ? "healthy"
      : offlineCount === totalCount
        ? "offline"
        : "degraded";

  return {
    overall,
    healthyCount,
    degradedCount,
    offlineCount,
    totalCount,
    services,
    rpc,
    indexer,
    stratum,
    comms,
  };
}
