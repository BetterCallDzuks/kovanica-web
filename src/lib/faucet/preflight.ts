import { ADDRESS_LENGTH, decodeAddress, encodeAddress } from "../wallet/address";

/** Canonical Kovanica Testnet network tag (Chain ID 2). */
export const FAUCET_CANONICAL_NETWORK_TAG = "2-24cdb5fadd98b207";

/** Canonical Kovanica Testnet chain ID. */
export const FAUCET_CHAIN_ID = 2;

const MAINNET_PREFIX = "kvnc";
const TESTNET_PREFIX = "tknc";
const ADDRESS_SUFFIX = "dag";

/** Address format classification reported by faucet pre-flight validation. */
export type FaucetAddressFormat = "pro21-mainnet" | "pro21-testnet" | "legacy-hex" | "invalid";

/** Pure verdict returned by `validateFaucetRecipient`. */
export interface FaucetPreflightVerdict {
  ok: boolean;
  canonicalAddress?: string;
  format?: FaucetAddressFormat;
  reason?: string;
  networkTag: string;
}

const UNSAFE_OR_XSS_PATTERN = /[<>'"`\\/\s]/;

function hasUnsafeOrControlChars(value: string): boolean {
  if (UNSAFE_OR_XSS_PATTERN.test(value)) {
    return true;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}
const BARE_HEX_64_PATTERN = /^[0-9a-f]{64}$/i;
const PREFIXED_HEX_64_PATTERN = /^0x[0-9a-f]{64}$/i;
const VERSIONED_HEX_66_PATTERN = /^00[0-9a-f]{64}$/i;
const LEGACY_CHECKED_HEX_PATTERN = /^kvnc[0-9a-f]{72}dag$/i;

function invalidVerdict(reason: string, format: FaucetAddressFormat = "invalid"): FaucetPreflightVerdict {
  return {
    ok: false,
    format,
    reason,
    networkTag: FAUCET_CANONICAL_NETWORK_TAG,
  };
}

/**
 * Pure pre-flight validator for Testnet faucet recipients (Chain 2 · `2-24cdb5fadd98b207`).
 *
 * - Accepts canonical 64-character PRO-21 addresses (`kvnc...dag` and `tknc...dag`) with valid
 *   29-bit BLAKE3 checksums.
 * - Rejects legacy raw hex formats on Testnet (Chain 2) with an actionable error message.
 * - Rejects corrupted checksums, malformed lengths, empty input, and XSS / control-char payloads.
 * - Never throws on arbitrary input.
 */
export function validateFaucetRecipient(input: string): FaucetPreflightVerdict {
  if (typeof input !== "string") {
    return invalidVerdict("Enter a canonical 64-character PRO-21 address (kvnc...dag or tknc...dag).");
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return invalidVerdict("Enter a canonical 64-character PRO-21 address (kvnc...dag or tknc...dag).");
  }

  if (hasUnsafeOrControlChars(trimmed)) {
    return invalidVerdict(
      "Address contains unsupported characters. Paste a canonical PRO-21 kvnc...dag or tknc...dag address.",
    );
  }

  if (
    BARE_HEX_64_PATTERN.test(trimmed) ||
    PREFIXED_HEX_64_PATTERN.test(trimmed) ||
    VERSIONED_HEX_66_PATTERN.test(trimmed) ||
    LEGACY_CHECKED_HEX_PATTERN.test(trimmed)
  ) {
    return invalidVerdict(
      `Legacy raw hex addresses are rejected on Testnet (Chain ${FAUCET_CHAIN_ID} · ${FAUCET_CANONICAL_NETWORK_TAG}). Use a canonical 64-character PRO-21 address (kvnc...dag or tknc...dag).`,
      "legacy-hex",
    );
  }

  const lower = trimmed.toLowerCase();
  const isMainnetPrefix = lower.startsWith(MAINNET_PREFIX);
  const isTestnetPrefix = lower.startsWith(TESTNET_PREFIX);

  if ((isMainnetPrefix || isTestnetPrefix) && lower.endsWith(ADDRESS_SUFFIX)) {
    if (lower.length !== ADDRESS_LENGTH) {
      return invalidVerdict(
        `PRO-21 address must be exactly ${ADDRESS_LENGTH} characters (got ${lower.length}).`,
      );
    }

    const decodeTarget = isTestnetPrefix
      ? `${MAINNET_PREFIX}${lower.slice(TESTNET_PREFIX.length)}`
      : lower;

    try {
      const payload = decodeAddress(decodeTarget);
      const canonicalAddress = encodeAddress(payload);
      return {
        ok: true,
        canonicalAddress,
        format: isTestnetPrefix ? "pro21-testnet" : "pro21-mainnet",
        networkTag: FAUCET_CANONICAL_NETWORK_TAG,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("checksum")) {
        return invalidVerdict(
          "PRO-21 checksum mismatch. Verify all 64 characters were copied without typos.",
        );
      }
      if (msg.includes("base32")) {
        return invalidVerdict(
          "Address contains an invalid character outside the PRO-21 base32 alphabet.",
        );
      }
      return invalidVerdict("Invalid PRO-21 address encoding.");
    }
  }

  return invalidVerdict(
    "Invalid address format. Expected a 64-character PRO-21 address (kvnc...dag or tknc...dag).",
  );
}

/**
 * Formats a faucet cooldown duration in seconds into a concise human-readable string.
 *
 * Examples:
 * - `0` -> `"Ready"`
 * - `45` -> `"45s"`
 * - `95` -> `"1m 35s"`
 * - `3661` -> `"1h 1m"`
 */
export function formatFaucetCooldown(remainingSeconds: number): string {
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
    return "Ready";
  }

  const totalSeconds = Math.ceil(remainingSeconds);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
