import {
  FAUCET_CANONICAL_NETWORK_TAG,
  FAUCET_CHAIN_ID,
  validateFaucetRecipient,
  type FaucetAddressFormat,
} from "./preflight";

export { FAUCET_CANONICAL_NETWORK_TAG, FAUCET_CHAIN_ID, type FaucetAddressFormat };

/** 1 KVNC = 10^9 atoms. */
export const ATOMS_PER_KVNC = 1_000_000_000;

/** Default low-balance warning threshold (100 KVNC = 10 standard dispenses). */
export const DEFAULT_LOW_BALANCE_THRESHOLD_ATOMS = 100 * ATOMS_PER_KVNC;

/** Pure validation result returned by `validateFaucetAddress`. */
export interface FaucetAddressValidationResult {
  valid: boolean;
  ok: boolean;
  format: FaucetAddressFormat;
  canonicalAddress?: string;
  networkTag: string;
  reason?: string;
}

/**
 * Pure PRO-21 testnet address pre-validator.
 *
 * Accepts canonical 64-character `kvnc...dag` and `tknc...dag` addresses with
 * valid 29-bit BLAKE3 checksums, and rejects legacy raw hex, malformed inputs,
 * invalid base32 characters, corrupted checksums, and XSS/control payloads.
 */
export function validateFaucetAddress(input: string): FaucetAddressValidationResult {
  const verdict = validateFaucetRecipient(input);
  return {
    valid: verdict.ok,
    ok: verdict.ok,
    format: verdict.format ?? "invalid",
    canonicalAddress: verdict.canonicalAddress,
    networkTag: verdict.networkTag,
    reason: verdict.reason,
  };
}

/**
 * Formats a remaining cooldown duration in milliseconds into a concise
 * human-readable countdown string.
 *
 * Examples:
 * - `0` -> `"Ready"`
 * - `45_000` -> `"45s"`
 * - `750_000` -> `"12m 30s"`
 * - `65_000` -> `"1m 05s"`
 * - `3_900_000` -> `"1h 05m"`
 * - `3_600_000` -> `"1h"`
 */
export function formatCooldownRemaining(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "Ready";
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${minutes}m`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${hours}h`;
}

/** Health badge classification for the faucet status bar. */
export type FaucetHealthStatus = "online" | "low_balance" | "unavailable";

/** Structured telemetry summary parsed from `kovanica-faucet` OpenMetrics or health payload. */
export interface FaucetTelemetrySummary {
  status: FaucetHealthStatus;
  available: boolean;
  balanceAtoms: number | null;
  balanceKvnc: number | null;
  dripsSucceededTotal: number | null;
  rateLimitedTotal: number | null;
  activeAddressCooldowns: number | null;
  uptimeSeconds: number | null;
}

/** Optional JSON/object input accepted by `parseFaucetTelemetrySummary`. */
export interface FaucetHealthInput {
  available?: boolean;
  lowBalance?: boolean;
  balance_atoms?: number | null;
  drips_succeeded_total?: number | null;
  rate_limited_total?: number | null;
  active_address_cooldowns?: number | null;
  uptime_seconds?: number | null;
}

export interface ParseFaucetTelemetryOptions {
  /** Minimum balance in atoms before reporting `low_balance` (default: 100 KVNC). */
  lowBalanceThresholdAtoms?: number;
}

const METRIC_LINE_PATTERN =
  /^(kovanica_faucet_[a-z0-9_]+)(?:\{[^}]*\})?\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:\s+\d+)?$/;

function finiteNonNegative(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function unavailableSummary(): FaucetTelemetrySummary {
  return {
    status: "unavailable",
    available: false,
    balanceAtoms: null,
    balanceKvnc: null,
    dripsSucceededTotal: null,
    rateLimitedTotal: null,
    activeAddressCooldowns: null,
    uptimeSeconds: null,
  };
}

function resolveStatus(
  available: boolean,
  balanceAtoms: number | null,
  lowBalanceThresholdAtoms: number,
  forceLowBalance = false,
): FaucetHealthStatus {
  if (!available) {
    return "unavailable";
  }
  if (forceLowBalance || (balanceAtoms !== null && balanceAtoms < lowBalanceThresholdAtoms)) {
    return "low_balance";
  }
  return "online";
}

/**
 * Parses `kovanica-faucet` OpenMetrics text or a structured health object into a
 * `FaucetTelemetrySummary`, safely degrading to `status: "unavailable"` when
 * offline, empty, or malformed.
 *
 * Recognized OpenMetrics series:
 * - `kovanica_faucet_balance_atoms`
 * - `kovanica_faucet_drips_succeeded_total`
 * - `kovanica_faucet_rate_limited_total`
 * - `kovanica_faucet_active_address_cooldowns`
 * - `kovanica_faucet_uptime_seconds`
 */
export function parseFaucetTelemetrySummary(
  input: string | FaucetHealthInput | null | undefined,
  options?: ParseFaucetTelemetryOptions,
): FaucetTelemetrySummary {
  const lowBalanceThresholdAtoms =
    options?.lowBalanceThresholdAtoms ?? DEFAULT_LOW_BALANCE_THRESHOLD_ATOMS;

  if (input === null || input === undefined) {
    return unavailableSummary();
  }

  if (typeof input === "object") {
    const balanceAtoms = finiteNonNegative(input.balance_atoms);
    const dripsSucceededTotal = finiteNonNegative(input.drips_succeeded_total);
    const rateLimitedTotal = finiteNonNegative(input.rate_limited_total);
    const activeAddressCooldowns = finiteNonNegative(input.active_address_cooldowns);
    const uptimeSeconds = finiteNonNegative(input.uptime_seconds);
    const hasAnyMetric =
      balanceAtoms !== null ||
      dripsSucceededTotal !== null ||
      rateLimitedTotal !== null ||
      activeAddressCooldowns !== null ||
      uptimeSeconds !== null;

    const available =
      typeof input.available === "boolean" ? input.available : hasAnyMetric;

    if (!available) {
      return unavailableSummary();
    }

    return {
      status: resolveStatus(
        available,
        balanceAtoms,
        lowBalanceThresholdAtoms,
        input.lowBalance === true,
      ),
      available,
      balanceAtoms,
      balanceKvnc: balanceAtoms !== null ? balanceAtoms / ATOMS_PER_KVNC : null,
      dripsSucceededTotal,
      rateLimitedTotal,
      activeAddressCooldowns,
      uptimeSeconds,
    };
  }

  if (typeof input !== "string" || input.trim().length === 0) {
    return unavailableSummary();
  }

  let balanceAtoms: number | null = null;
  let dripsSucceededTotal: number | null = null;
  let rateLimitedTotal: number | null = null;
  let activeAddressCooldowns: number | null = null;
  let uptimeSeconds: number | null = null;
  let matchedKnownMetric = false;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const match = METRIC_LINE_PATTERN.exec(line);
    if (!match) {
      continue;
    }

    const metricName = match[1];
    const parsedValue = Number(match[2]);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      continue;
    }

    switch (metricName) {
      case "kovanica_faucet_balance_atoms":
        balanceAtoms = parsedValue;
        matchedKnownMetric = true;
        break;
      case "kovanica_faucet_drips_succeeded_total":
        dripsSucceededTotal = parsedValue;
        matchedKnownMetric = true;
        break;
      case "kovanica_faucet_rate_limited_total":
        rateLimitedTotal = parsedValue;
        matchedKnownMetric = true;
        break;
      case "kovanica_faucet_active_address_cooldowns":
        activeAddressCooldowns = parsedValue;
        matchedKnownMetric = true;
        break;
      case "kovanica_faucet_uptime_seconds":
        uptimeSeconds = parsedValue;
        matchedKnownMetric = true;
        break;
      default:
        break;
    }
  }

  if (!matchedKnownMetric) {
    return unavailableSummary();
  }

  return {
    status: resolveStatus(true, balanceAtoms, lowBalanceThresholdAtoms),
    available: true,
    balanceAtoms,
    balanceKvnc: balanceAtoms !== null ? balanceAtoms / ATOMS_PER_KVNC : null,
    dripsSucceededTotal,
    rateLimitedTotal,
    activeAddressCooldowns,
    uptimeSeconds,
  };
}

/** Formats a faucet balance in atoms as a compact KVNC string (or `"—"` when unavailable). */
export function formatFaucetBalanceKvnc(balanceAtoms: number | null): string {
  if (balanceAtoms === null || !Number.isFinite(balanceAtoms) || balanceAtoms < 0) {
    return "—";
  }
  const kvnc = balanceAtoms / ATOMS_PER_KVNC;
  return `${kvnc.toLocaleString("en-US", { maximumFractionDigits: 2 })} KVNC`;
}
