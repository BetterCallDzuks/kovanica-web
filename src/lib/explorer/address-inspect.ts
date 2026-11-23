import { blake3 } from "@noble/hashes/blake3.js";
import { ADDRESS_LENGTH, encodeAddress } from "@/lib/wallet/address";

export type ExplorerAddressFormat =
  | "pro21-mainnet"
  | "pro21-testnet"
  | "legacy-hex"
  | "invalid";

export interface ExplorerAddressInspection {
  valid: boolean;
  format: ExplorerAddressFormat;
  checksumValid: boolean;
  canonicalMainnet?: string;
  canonicalTestnet?: string;
  payloadHex?: string;
  error?: string;
}

const MAINNET_PREFIX = "kvnc";
const TESTNET_PREFIX = "tknc";
const ADDRESS_SUFFIX = "dag";
const BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const CHECKSUM_BITS = 29;
const PAYLOAD_BYTES = 32;
const LEGACY_CHECKED_HEX_BODY_LEN = 72; // 32-byte payload + 4-byte blake3 checksum
const LEGACY_CHECKED_HEX_LEN =
  MAINNET_PREFIX.length + LEGACY_CHECKED_HEX_BODY_LEN + ADDRESS_SUFFIX.length;

function checksum29(payload: Uint8Array): bigint {
  const digest = blake3(payload);
  const word =
    (BigInt(digest[0]) << 24n) |
    (BigInt(digest[1]) << 16n) |
    (BigInt(digest[2]) << 8n) |
    BigInt(digest[3]);
  return word >> BigInt(32 - CHECKSUM_BITS);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function buildValidInspection(
  format: Exclude<ExplorerAddressFormat, "invalid">,
  payload: Uint8Array,
  checksumValid: boolean,
): ExplorerAddressInspection {
  const canonicalMainnet = encodeAddress(payload);
  const canonicalTestnet = `${TESTNET_PREFIX}${canonicalMainnet.slice(MAINNET_PREFIX.length)}`;
  return {
    valid: true,
    format,
    checksumValid,
    canonicalMainnet,
    canonicalTestnet,
    payloadHex: `0x${bytesToHex(payload)}`,
  };
}

function buildInvalidInspection(error: string): ExplorerAddressInspection {
  return {
    valid: false,
    format: "invalid",
    checksumValid: false,
    error,
  };
}

function decodePro21Address(
  trimmed: string,
  prefix: typeof MAINNET_PREFIX | typeof TESTNET_PREFIX,
): ExplorerAddressInspection {
  const body = trimmed.slice(prefix.length, trimmed.length - ADDRESS_SUFFIX.length);
  let packed = 0n;
  for (let i = 0; i < body.length; i += 1) {
    const val = BECH32_ALPHABET.indexOf(body[i]);
    if (val < 0) {
      return buildInvalidInspection(
        "PRO-21 address contains a character outside the lowercase bech32 alphabet",
      );
    }
    packed = (packed << 5n) | BigInt(val);
  }

  const actualChecksum = packed & ((1n << BigInt(CHECKSUM_BITS)) - 1n);
  const keyBits = packed >> BigInt(CHECKSUM_BITS);
  const keyHex = keyBits.toString(16).padStart(PAYLOAD_BYTES * 2, "0");
  const payload = hexToBytes(keyHex);

  if (actualChecksum !== checksum29(payload)) {
    return buildInvalidInspection("PRO-21 address checksum mismatch");
  }

  return buildValidInspection(
    prefix === MAINNET_PREFIX ? "pro21-mainnet" : "pro21-testnet",
    payload,
    true,
  );
}

/**
 * Inspects an arbitrary Explorer address input for PRO-21 (`kvnc...dag` / `tknc...dag`)
 * checksum integrity, legacy 32-byte hex format, canonical forms, and raw 32-byte payload hex.
 *
 * Pure helper — never throws on arbitrary or malformed input.
 */
export function inspectExplorerAddress(input: string): ExplorerAddressInspection {
  if (typeof input !== "string") {
    return buildInvalidInspection("Address must be a string");
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return buildInvalidInspection("Address must not be empty");
  }

  // 1. Canonical PRO-21 mainnet (kvnc...dag, 64 chars)
  if (
    trimmed.length === ADDRESS_LENGTH &&
    trimmed.startsWith(MAINNET_PREFIX) &&
    trimmed.endsWith(ADDRESS_SUFFIX)
  ) {
    return decodePro21Address(trimmed, MAINNET_PREFIX);
  }

  // 2. Canonical PRO-21 testnet (tknc...dag, 64 chars)
  if (
    trimmed.length === ADDRESS_LENGTH &&
    trimmed.startsWith(TESTNET_PREFIX) &&
    trimmed.endsWith(ADDRESS_SUFFIX)
  ) {
    return decodePro21Address(trimmed, TESTNET_PREFIX);
  }

  // 3. Legacy checked hex (kvnc + 72 hex chars + dag)
  if (
    trimmed.length === LEGACY_CHECKED_HEX_LEN &&
    trimmed.startsWith(MAINNET_PREFIX) &&
    trimmed.endsWith(ADDRESS_SUFFIX)
  ) {
    const body = trimmed.slice(MAINNET_PREFIX.length, -ADDRESS_SUFFIX.length);
    if (!/^[0-9a-fA-F]{72}$/.test(body)) {
      return buildInvalidInspection("Legacy address payload must be 72 hexadecimal characters");
    }
    const bytes = hexToBytes(body);
    const payload = bytes.slice(0, PAYLOAD_BYTES);
    const actualCheck = bytes.slice(PAYLOAD_BYTES);
    const expectedCheck = blake3(payload).slice(0, 4);
    for (let i = 0; i < 4; i += 1) {
      if (actualCheck[i] !== expectedCheck[i]) {
        return buildInvalidInspection("Legacy hex address checksum mismatch");
      }
    }
    return buildValidInspection("legacy-hex", payload, true);
  }

  // 4. Bare 64-hex or 0x-prefixed 64-hex (32-byte raw payload, no embedded checksum)
  if (/^(?:0[xX])?[0-9a-fA-F]{64}$/.test(trimmed)) {
    const cleanHex = trimmed.replace(/^0[xX]/, "").toLowerCase();
    return buildValidInspection("legacy-hex", hexToBytes(cleanHex), false);
  }

  // 5. Helpful diagnostics for near-miss PRO-21 strings
  const lower = trimmed.toLowerCase();
  if (
    (lower.startsWith(MAINNET_PREFIX) || lower.startsWith(TESTNET_PREFIX)) &&
    lower.endsWith(ADDRESS_SUFFIX)
  ) {
    if (trimmed !== lower) {
      return buildInvalidInspection("PRO-21 addresses must be lowercase");
    }
    return buildInvalidInspection(
      `PRO-21 address must be exactly ${ADDRESS_LENGTH} characters`,
    );
  }

  return buildInvalidInspection(
    "Invalid address format: expected a 64-character PRO-21 (kvnc...dag / tknc...dag) or 32-byte hex address",
  );
}
