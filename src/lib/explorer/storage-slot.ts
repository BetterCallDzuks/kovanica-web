/**
 * Browser-safe Contract Storage Slot Deriver & Value Decoder for the Explorer.
 *
 * `deriveStorageSlot` and `deriveStorageSlotHex` match `kovanica-sdk/src/decoders.ts`
 * byte-for-byte using BLAKE3 over UTF-8 prefixes and canonical key encodings.
 */

import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, concatBytes, hexToBytes, u64le } from "../contracts/decoders";
import { encodeAddress, parseAddr } from "../wallet/address";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER_FATAL = new TextDecoder("utf-8", { fatal: true });

const MAX_U64 = (1n << 64n) - 1n;
const MAX_U128 = (1n << 128n) - 1n;

/**
 * Canonical storage key prefixes matching `kovanica-sdk` (`STORAGE_KEY_PREFIXES`)
 * and the on-chain Kovanica Wasmi contract templates.
 */
export const STORAGE_KEY_PREFIXES = {
  STATE: "kvnc/v1/state",
  POOL: "kvnc/v1/pool",
  LP: "kvnc/v1/lp/",
  HTLC: "kvnc/v1/htlc/",
  VAULT: "kvnc/v1/vault/",
  MULTISIG_TX: "kvnc/v1/mtx/",
  NAME: "kvnc/v1/name/",
  ESCROW: "kvnc/v1/escrow/",
} as const;

export type StorageSlotContract =
  | "state"
  | "token"
  | "token_pool"
  | "token_lp"
  | "nft"
  | "multisig"
  | "multisig_tx"
  | "htlc"
  | "vault"
  | "name"
  | "escrow";

export type StorageSlotKey = Uint8Array | string | bigint | number;

function parseFixed32Key(key: StorageSlotKey | undefined, label: string): Uint8Array {
  if (key === undefined) {
    throw new Error(`${label} requires a 32-byte key`);
  }
  if (typeof key === "bigint" || typeof key === "number") {
    throw new Error(`${label} requires a 32-byte Uint8Array, 64-char hex, or kvnc…dag address`);
  }
  if (key instanceof Uint8Array) {
    if (key.length !== 32) {
      throw new Error(`${label} requires exactly 32 bytes, got ${key.length}`);
    }
    return key;
  }

  const trimmed = key.trim();
  if (!trimmed) {
    throw new Error(`${label} requires a non-empty 32-byte key`);
  }

  if (trimmed.startsWith("kvnc") || trimmed.startsWith("tknc")) {
    const addrHex = parseAddr(trimmed);
    if (!addrHex) {
      throw new Error(`${label} received an invalid Kovanica address`);
    }
    const addrBytes = hexToBytes(addrHex);
    if (!addrBytes || addrBytes.length !== 32) {
      throw new Error(`${label} requires exactly 32 bytes`);
    }
    return addrBytes;
  }

  const bytes = hexToBytes(trimmed);
  if (bytes === null) {
    throw new Error(`${label} received an invalid hex key`);
  }
  if (bytes.length !== 32) {
    throw new Error(`${label} requires exactly 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

/**
 * Derives a raw 32-byte BLAKE3 storage slot: `blake3(prefix || key)`.
 * Matches `kovanica-sdk`'s `derivePrefixedStorageSlot` byte-for-byte.
 */
export function derivePrefixedStorageSlot(
  prefix: string | Uint8Array,
  key?: Uint8Array | string,
): Uint8Array {
  const prefixBytes = typeof prefix === "string" ? UTF8_ENCODER.encode(prefix) : prefix;
  if (key === undefined) {
    return blake3(prefixBytes);
  }
  const keyBytes = typeof key === "string" ? UTF8_ENCODER.encode(key) : key;
  return blake3(concatBytes([prefixBytes, keyBytes]));
}

/**
 * Derives the canonical 32-byte BLAKE3 storage slot for `kovanica_getStorageAt`.
 * Matches `kovanica-sdk`'s `deriveStorageSlot` byte-for-byte:
 * - `"state" | "token" | "nft" | "multisig"`: `blake3("kvnc/v1/state")`
 * - `"token_pool"`: `blake3("kvnc/v1/pool")`
 * - `"token_lp"`: `blake3("kvnc/v1/lp/" || address32)`
 * - `"htlc"`: `blake3("kvnc/v1/htlc/" || swapId32)`
 * - `"vault"`: `blake3("kvnc/v1/vault/" || vaultId32)`
 * - `"multisig_tx"`: `blake3("kvnc/v1/mtx/" || u64le(txId))`
 * - `"name"`: `blake3("kvnc/v1/name/" || utf8(lowercaseName))`
 * - `"escrow"`: `blake3("kvnc/v1/escrow/" || escrowId32)`
 */
export function deriveStorageSlot(
  contract: StorageSlotContract,
  key?: StorageSlotKey,
): Uint8Array {
  switch (contract) {
    case "state":
    case "token":
    case "nft":
    case "multisig":
      return derivePrefixedStorageSlot(STORAGE_KEY_PREFIXES.STATE);

    case "token_pool":
      return derivePrefixedStorageSlot(STORAGE_KEY_PREFIXES.POOL);

    case "token_lp":
      return derivePrefixedStorageSlot(
        STORAGE_KEY_PREFIXES.LP,
        parseFixed32Key(key, "deriveStorageSlot(token_lp)"),
      );

    case "htlc":
      return derivePrefixedStorageSlot(
        STORAGE_KEY_PREFIXES.HTLC,
        parseFixed32Key(key, "deriveStorageSlot(htlc)"),
      );

    case "vault":
      return derivePrefixedStorageSlot(
        STORAGE_KEY_PREFIXES.VAULT,
        parseFixed32Key(key, "deriveStorageSlot(vault)"),
      );

    case "multisig_tx": {
      if (key === undefined) {
        throw new Error("deriveStorageSlot(multisig_tx) requires a u64 txId");
      }
      if (key instanceof Uint8Array) {
        if (key.length !== 8) {
          throw new Error(
            `deriveStorageSlot(multisig_tx) Uint8Array key must be 8 bytes, got ${key.length}`,
          );
        }
        return derivePrefixedStorageSlot(STORAGE_KEY_PREFIXES.MULTISIG_TX, key);
      }
      if (typeof key === "string") {
        throw new Error(
          "deriveStorageSlot(multisig_tx) requires a bigint, number, or 8-byte Uint8Array",
        );
      }
      return derivePrefixedStorageSlot(STORAGE_KEY_PREFIXES.MULTISIG_TX, u64le(key));
    }

    case "name": {
      if (typeof key !== "string" || key.trim().length === 0) {
        throw new Error("deriveStorageSlot(name) requires a non-empty name string");
      }
      return derivePrefixedStorageSlot(STORAGE_KEY_PREFIXES.NAME, key.trim().toLowerCase());
    }

    case "escrow":
      return derivePrefixedStorageSlot(
        STORAGE_KEY_PREFIXES.ESCROW,
        parseFixed32Key(key, "deriveStorageSlot(escrow)"),
      );

    default: {
      const exhaustive: never = contract;
      throw new Error(`Unknown storage slot contract: ${String(exhaustive)}`);
    }
  }
}

/**
 * Same as `deriveStorageSlot`, returning a 64-char lowercase hex string (no `0x` prefix),
 * matching `kovanica-sdk`'s `deriveStorageSlotHex` byte-for-byte.
 */
export function deriveStorageSlotHex(
  contract: StorageSlotContract,
  key?: StorageSlotKey,
): string {
  return bytesToHex(deriveStorageSlot(contract, key));
}

// --- Explorer UI Mode-Based Slot Deriver ---

export type StorageSlotMode = "raw_hex" | "utf8" | "mapping";

export type MappingKeyEncoding = "utf8" | "address_or_hex32" | "u64le" | "hex";

export type MappingTemplate = {
  id: string;
  label: string;
  prefix: string;
  encoding: MappingKeyEncoding;
  lowercase?: boolean;
  placeholder: string;
  sampleKey: string;
};

export const MAPPING_TEMPLATES: readonly MappingTemplate[] = [
  {
    id: "name",
    label: "Name (kvnc/v1/name/)",
    prefix: STORAGE_KEY_PREFIXES.NAME,
    encoding: "utf8",
    lowercase: true,
    placeholder: "alice",
    sampleKey: "alice",
  },
  {
    id: "token_lp",
    label: "LP Position (kvnc/v1/lp/)",
    prefix: STORAGE_KEY_PREFIXES.LP,
    encoding: "address_or_hex32",
    placeholder: "kvnc…dag or 64-char hex address",
    sampleKey: "0000000000000000000000000000000000000000000000000000000000000001",
  },
  {
    id: "htlc",
    label: "HTLC (kvnc/v1/htlc/)",
    prefix: STORAGE_KEY_PREFIXES.HTLC,
    encoding: "address_or_hex32",
    placeholder: "32-byte swap ID hex",
    sampleKey: "0000000000000000000000000000000000000000000000000000000000000001",
  },
  {
    id: "vault",
    label: "Vault (kvnc/v1/vault/)",
    prefix: STORAGE_KEY_PREFIXES.VAULT,
    encoding: "address_or_hex32",
    placeholder: "32-byte vault ID hex",
    sampleKey: "0000000000000000000000000000000000000000000000000000000000000001",
  },
  {
    id: "escrow",
    label: "Escrow (kvnc/v1/escrow/)",
    prefix: STORAGE_KEY_PREFIXES.ESCROW,
    encoding: "address_or_hex32",
    placeholder: "32-byte escrow ID hex",
    sampleKey: "0000000000000000000000000000000000000000000000000000000000000001",
  },
  {
    id: "multisig_tx",
    label: "Multisig Tx (kvnc/v1/mtx/)",
    prefix: STORAGE_KEY_PREFIXES.MULTISIG_TX,
    encoding: "u64le",
    placeholder: "u64 txId (e.g. 0, 1, 42)",
    sampleKey: "0",
  },
];

export type StorageSlotDeriveInput =
  | { mode: "raw_hex"; rawHex: string }
  | { mode: "utf8"; utf8Key: string }
  | {
      mode: "mapping";
      prefix: string;
      key: string;
      encoding: MappingKeyEncoding;
      lowercaseUtf8?: boolean;
    };

export type StorageSlotDeriveResult =
  | {
      ok: true;
      slotHex: string;
      slotHexBare: string;
      derivationLabel: string;
      preimageBytes: number;
    }
  | {
      ok: false;
      error: string;
    };

function parseU64DecimalOrHex(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!trimmed || !/^(?:0[xX][0-9a-fA-F]+|\d+)$/.test(trimmed)) return null;
  try {
    const val = BigInt(trimmed);
    if (val < 0n || val > MAX_U64) return null;
    return val;
  } catch {
    return null;
  }
}

/**
 * Derive a 32-byte storage slot from Explorer UI inputs (`raw_hex`, `utf8`, or `mapping`).
 */
export function deriveSlotByMode(input: StorageSlotDeriveInput): StorageSlotDeriveResult {
  if (input.mode === "raw_hex") {
    const trimmed = input.rawHex.trim();
    if (!trimmed) {
      return { ok: false, error: "Enter a 32-byte hex slot (64 hex characters)." };
    }
    const clean = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
    if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
      return {
        ok: false,
        error: "Raw hex slot must be exactly 32 bytes (64 hexadecimal characters).",
      };
    }
    const bare = clean.toLowerCase();
    return {
      ok: true,
      slotHex: `0x${bare}`,
      slotHexBare: bare,
      derivationLabel: "raw 32-byte hex",
      preimageBytes: 32,
    };
  }

  if (input.mode === "utf8") {
    const trimmed = input.utf8Key.trim();
    if (!trimmed) {
      return { ok: false, error: "Enter a non-empty UTF-8 storage key." };
    }
    const bytes = UTF8_ENCODER.encode(trimmed);
    const bare = bytesToHex(blake3(bytes));
    return {
      ok: true,
      slotHex: `0x${bare}`,
      slotHexBare: bare,
      derivationLabel: `blake3("${trimmed}")`,
      preimageBytes: bytes.length,
    };
  }

  // Mapping mode: blake3(utf8(prefix) || encodedKey)
  const prefix = input.prefix;
  if (!prefix.trim()) {
    return { ok: false, error: "Enter a mapping key prefix (e.g. kvnc/v1/lp/)." };
  }
  const keyTrimmed = input.key.trim();
  if (!keyTrimmed) {
    return { ok: false, error: "Enter a mapping key value." };
  }

  const prefixBytes = UTF8_ENCODER.encode(prefix);
  let keyBytes: Uint8Array;

  switch (input.encoding) {
    case "utf8": {
      const normalized = input.lowercaseUtf8 ? keyTrimmed.toLowerCase() : keyTrimmed;
      keyBytes = UTF8_ENCODER.encode(normalized);
      break;
    }
    case "address_or_hex32": {
      try {
        keyBytes = parseFixed32Key(keyTrimmed, "Mapping key");
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "Mapping key must be a valid kvnc…dag address or 32-byte hex.",
        };
      }
      break;
    }
    case "u64le": {
      const parsed = parseU64DecimalOrHex(keyTrimmed);
      if (parsed === null) {
        return {
          ok: false,
          error: "Mapping key must be an unsigned 64-bit integer (0 to 2^64-1).",
        };
      }
      keyBytes = u64le(parsed);
      break;
    }
    case "hex": {
      const bytes = hexToBytes(keyTrimmed);
      if (bytes === null || bytes.length === 0) {
        return {
          ok: false,
          error: "Mapping hex key must be non-empty even-length hexadecimal bytes.",
        };
      }
      keyBytes = bytes;
      break;
    }
  }

  const preimage = concatBytes([prefixBytes, keyBytes]);
  const bare = bytesToHex(blake3(preimage));
  return {
    ok: true,
    slotHex: `0x${bare}`,
    slotHexBare: bare,
    derivationLabel: `blake3("${prefix}" || ${input.encoding})`,
    preimageBytes: preimage.length,
  };
}

// --- Storage Value Decoders ---

export function decodeUintBe(bytes: Uint8Array): bigint {
  let acc = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    acc = (acc << 8n) | BigInt(bytes[i]!);
  }
  return acc;
}

export function decodeUintLe(bytes: Uint8Array): bigint {
  let acc = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    acc = (acc << 8n) | BigInt(bytes[i]!);
  }
  return acc;
}

export function decodeU64Be(bytes: Uint8Array): bigint | null {
  if (bytes.length === 8) return decodeUintBe(bytes);
  if (bytes.length === 32) {
    const val = decodeUintBe(bytes);
    return val <= MAX_U64 ? val : null;
  }
  return null;
}

export function decodeU64Le(bytes: Uint8Array): bigint | null {
  if (bytes.length === 8) return decodeUintLe(bytes);
  if (bytes.length === 32) {
    const val = decodeUintLe(bytes);
    return val <= MAX_U64 ? val : null;
  }
  return null;
}

export function decodeU128Be(bytes: Uint8Array): bigint | null {
  if (bytes.length === 16) return decodeUintBe(bytes);
  if (bytes.length === 32) {
    const val = decodeUintBe(bytes);
    return val <= MAX_U128 ? val : null;
  }
  return null;
}

export function decodeU128Le(bytes: Uint8Array): bigint | null {
  if (bytes.length === 16) return decodeUintLe(bytes);
  if (bytes.length === 32) {
    const val = decodeUintLe(bytes);
    return val <= MAX_U128 ? val : null;
  }
  return null;
}

function isPrintableText(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return false;
    }
    if (code === 0x7f) return false;
  }
  return true;
}

/**
 * Decode bytes as a printable UTF-8 preview string, or `null` if empty,
 * invalid UTF-8, or containing non-printable control characters.
 */
export function decodeUtf8Preview(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  try {
    const decoded = UTF8_DECODER_FATAL.decode(bytes);
    return isPrintableText(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export type DecodedStorageValue = {
  validHex: boolean;
  rawHex: string;
  byteLength: number;
  isEmpty: boolean;
  isAllZero: boolean;
  utf8Preview: string | null;
  u64Le: string | null;
  u64Be: string | null;
  u128Le: string | null;
  u128Be: string | null;
  u256Be: string | null;
  u256Le: string | null;
  address: string | null;
};

/**
 * Decode a raw hex storage value returned by `kovanica_getStorageAt` into
 * human-readable integer, address, and printable UTF-8 views.
 */
export function decodeStorageValue(rawHexInput: string | null | undefined): DecodedStorageValue {
  const trimmed = (rawHexInput ?? "").trim();
  if (!trimmed || trimmed === "0x" || trimmed === "0X") {
    return {
      validHex: true,
      rawHex: "0x",
      byteLength: 0,
      isEmpty: true,
      isAllZero: true,
      utf8Preview: null,
      u64Le: null,
      u64Be: null,
      u128Le: null,
      u128Be: null,
      u256Be: null,
      u256Le: null,
      address: null,
    };
  }

  const bytes = hexToBytes(trimmed);
  if (bytes === null) {
    return {
      validHex: false,
      rawHex: trimmed,
      byteLength: 0,
      isEmpty: false,
      isAllZero: false,
      utf8Preview: null,
      u64Le: null,
      u64Be: null,
      u128Le: null,
      u128Be: null,
      u256Be: null,
      u256Le: null,
      address: null,
    };
  }

  const normalizedHex = `0x${bytesToHex(bytes)}`;
  const isAllZero = bytes.every((b) => b === 0);
  const isEmpty = bytes.length === 0 || (bytes.length === 32 && isAllZero);

  const u64LeVal = decodeU64Le(bytes);
  const u64BeVal = decodeU64Be(bytes);
  const u128LeVal = decodeU128Le(bytes);
  const u128BeVal = decodeU128Be(bytes);

  let u256Be: string | null = null;
  let u256Le: string | null = null;
  let address: string | null = null;

  if (bytes.length === 32) {
    u256Be = decodeUintBe(bytes).toString();
    u256Le = decodeUintLe(bytes).toString();
    if (!isAllZero) {
      try {
        address = encodeAddress(bytes);
      } catch {
        address = null;
      }
    }
  }

  return {
    validHex: true,
    rawHex: normalizedHex,
    byteLength: bytes.length,
    isEmpty,
    isAllZero,
    utf8Preview: isAllZero ? null : decodeUtf8Preview(bytes),
    u64Le: u64LeVal !== null ? u64LeVal.toString() : null,
    u64Be: u64BeVal !== null ? u64BeVal.toString() : null,
    u128Le: u128LeVal !== null ? u128LeVal.toString() : null,
    u128Be: u128BeVal !== null ? u128BeVal.toString() : null,
    u256Be,
    u256Le,
    address,
  };
}
