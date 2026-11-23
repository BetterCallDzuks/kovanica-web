/**
 * Contract Read / Dry-Run Inspector helpers.
 *
 * Provides typed Bincode argument builders for canonical Kovanica Wasmi entry
 * points, `kovanica_call` request validation, multi-format output decoding
 * (including `NameEntry`, integers, addresses, UTF-8/JSON, and raw hex), and
 * structured revert/error classification.
 */

import { blake3 } from "@noble/hashes/blake3.js";
import { decodeToken } from "../tokens/codec";
import { encodeAddress, parseAddr, toCanonicalAddress } from "../wallet/address";
import {
  BincodeReader,
  buildEscrowCreateCall,
  buildHtlcCreateCall,
  buildNameRegisterCall,
  buildNftMintCall,
  buildTokenTransferCall,
  buildVaultCreateCall,
  bytesToHex,
  concatBytes,
  decodeEscrowCreateArgs,
  decodeHtlcCreateArgs,
  decodeMultisigCreateArgs,
  decodeVaultCreateArgs,
  encodeBincodeBytes32Vec,
  encodeBincodeString,
  encodeBincodeStringVec,
  hexToBytes,
  readBincodeString,
  readBincodeStringVec,
  u32le,
  u64le,
  u128le,
} from "./decoders";

export type ContractPresetId =
  | "name_resolve"
  | "name_register"
  | "token_transfer"
  | "nft_mint"
  | "escrow_create"
  | "htlc_create"
  | "vault_create"
  | "custom";

export type ContractFieldDef = {
  key: string;
  label: string;
  placeholder: string;
  helper?: string;
  kind: "text" | "address" | "hex32" | "uint" | "csv" | "hex";
  required?: boolean;
};

export type ContractPreset = {
  id: ContractPresetId;
  label: string;
  entry: string;
  category: "Read" | "Simulate" | "Raw";
  description: string;
  fields: ContractFieldDef[];
  defaults: Record<string, string>;
};

export const CONTRACT_PRESETS: readonly ContractPreset[] = [
  {
    id: "name_resolve",
    label: "name_resolve",
    entry: "name_resolve",
    category: "Read",
    description:
      "Resolve a name from the on-chain comms Name Registry and decode the returned Bincode NameEntry.",
    fields: [
      {
        key: "name",
        label: "Name",
        placeholder: "alice",
        helper: "3–32 lowercase ASCII chars ([a-z0-9-]), e.g. alice",
        kind: "text",
        required: true,
      },
    ],
    defaults: { name: "alice" },
  },
  {
    id: "name_register",
    label: "name_register",
    entry: "name_register",
    category: "Simulate",
    description:
      "Dry-run registering a comms name bound to an Ed25519 pubkey and relay endpoints.",
    fields: [
      {
        key: "name",
        label: "Name",
        placeholder: "alice",
        kind: "text",
        required: true,
      },
      {
        key: "pubkey",
        label: "Owner / Comms Pubkey",
        placeholder: "kvnc…dag or 64-char hex",
        kind: "address",
        required: true,
      },
      {
        key: "relayEndpoints",
        label: "Relay Endpoints",
        placeholder: "https://relay1.kovanica.online, https://relay2.kovanica.online",
        helper: "Comma-separated http(s):// URLs (optional)",
        kind: "csv",
      },
    ],
    defaults: {
      name: "alice",
      pubkey: "",
      relayEndpoints: "https://relay.kovanica.online",
    },
  },
  {
    id: "token_transfer",
    label: "token_transfer",
    entry: "token_transfer",
    category: "Simulate",
    description:
      "Dry-run a KVP-102 token transfer to verify balance, pause state, and estimated gas.",
    fields: [
      {
        key: "to",
        label: "Recipient Address",
        placeholder: "kvnc…dag or 64-char hex",
        kind: "address",
        required: true,
      },
      {
        key: "amount",
        label: "Amount (base units)",
        placeholder: "1000000000",
        helper: "Unsigned 128-bit integer in token base units",
        kind: "uint",
        required: true,
      },
    ],
    defaults: { to: "", amount: "1000000000" },
  },
  {
    id: "nft_mint",
    label: "nft_mint",
    entry: "nft_mint",
    category: "Simulate",
    description:
      "Dry-run minting a KVP-106 NFT token within a collection contract.",
    fields: [
      {
        key: "collection",
        label: "Collection ID (32 bytes)",
        placeholder: "64-char hex or kvnc…dag",
        kind: "hex32",
        required: true,
      },
      {
        key: "to",
        label: "Recipient Address",
        placeholder: "kvnc…dag or 64-char hex",
        kind: "address",
        required: true,
      },
      {
        key: "tokenId",
        label: "Token ID (u128)",
        placeholder: "1",
        kind: "uint",
        required: true,
      },
      {
        key: "tokenUri",
        label: "Token URI",
        placeholder: "ipfs://QmExampleMetadata",
        kind: "text",
        required: true,
      },
    ],
    defaults: {
      collection: "",
      to: "",
      tokenId: "1",
      tokenUri: "ipfs://QmKovanicaExample",
    },
  },
  {
    id: "escrow_create",
    label: "escrow_create",
    entry: "escrow_create",
    category: "Simulate",
    description:
      "Dry-run creating a multi-party M-of-N threshold escrow.",
    fields: [
      {
        key: "parties",
        label: "Party Addresses (comma-separated)",
        placeholder: "kvnc…dag, kvnc…dag",
        kind: "csv",
        required: true,
      },
      {
        key: "threshold",
        label: "Approval Threshold (u8)",
        placeholder: "2",
        kind: "uint",
        required: true,
      },
      {
        key: "amount",
        label: "Amount (atoms, u64)",
        placeholder: "5000000000",
        kind: "uint",
        required: true,
      },
      {
        key: "deadline",
        label: "Deadline (Unix seconds, u64)",
        placeholder: "1800000000",
        kind: "uint",
        required: true,
      },
    ],
    defaults: {
      parties: "",
      threshold: "2",
      amount: "5000000000",
      deadline: "1800000000",
    },
  },
  {
    id: "htlc_create",
    label: "htlc_create",
    entry: "htlc_create",
    category: "Simulate",
    description:
      "Dry-run creating a Hash Time-Locked Contract (hashlock, timelock, recipient).",
    fields: [
      {
        key: "hashlock",
        label: "Hashlock (32-byte hex)",
        placeholder: "64-char hex digest",
        kind: "hex32",
        required: true,
      },
      {
        key: "timelock",
        label: "Timelock (Unix seconds, u64)",
        placeholder: "1800000000",
        kind: "uint",
        required: true,
      },
      {
        key: "recipient",
        label: "Recipient Address",
        placeholder: "kvnc…dag or 64-char hex",
        kind: "address",
        required: true,
      },
    ],
    defaults: {
      hashlock: "",
      timelock: "1800000000",
      recipient: "",
    },
  },
  {
    id: "vault_create",
    label: "vault_create",
    entry: "vault_create",
    category: "Simulate",
    description:
      "Dry-run creating a time-locked KVNC vault for an owner/beneficiary.",
    fields: [
      {
        key: "owner",
        label: "Owner / Beneficiary Address",
        placeholder: "kvnc…dag or 64-char hex",
        kind: "address",
        required: true,
      },
      {
        key: "lockUntil",
        label: "Lock Until (Unix seconds, u64)",
        placeholder: "1800000000",
        kind: "uint",
        required: true,
      },
    ],
    defaults: {
      owner: "",
      lockUntil: "1800000000",
    },
  },
  {
    id: "custom",
    label: "Custom / Raw Hex",
    entry: "",
    category: "Raw",
    description:
      "Call any Wasmi entry point with raw hex-encoded Bincode or custom binary arguments.",
    fields: [
      {
        key: "entry",
        label: "Entry Point (optional)",
        placeholder: "call (or e.g. name_resolve, token_transfer)",
        helper: "Leave blank to let the node auto-detect or default to `call`",
        kind: "text",
      },
      {
        key: "data",
        label: "Call Data (Hex)",
        placeholder: "0x",
        helper: "Even-length hex bytes (optional 0x prefix)",
        kind: "hex",
      },
    ],
    defaults: { entry: "call", data: "0x" },
  },
];

export function getContractPreset(id: ContractPresetId): ContractPreset {
  return CONTRACT_PRESETS.find((p) => p.id === id) ?? CONTRACT_PRESETS[0]!;
}

// --- Input Parsing & Encoding ---

const MAX_U64 = (1n << 64n) - 1n;
const MAX_U128 = (1n << 128n) - 1n;

/** Parse a `kvnc…dag` address or 32-byte hex string into 32 raw bytes. */
export function parseAddressBytes32(raw: string): Uint8Array | null {
  const hex = parseAddr(raw);
  if (!hex) return null;
  const bytes = hexToBytes(hex);
  return bytes && bytes.length === 32 ? bytes : null;
}

/** Parse a non-negative integer (decimal or `0x` hex) within `[0, max]`. */
export function parseUintQuantity(
  raw: string,
  fieldName: string,
  max: bigint = MAX_U64,
): { ok: true; value: bigint | null; hex: string | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null, hex: null };

  if (!/^(?:0[xX][0-9a-fA-F]+|\d+)$/.test(trimmed)) {
    return { ok: false, error: `${fieldName} must be a non-negative integer or 0x hex quantity` };
  }

  try {
    const value = BigInt(trimmed);
    if (value < 0n || value > max) {
      return { ok: false, error: `${fieldName} is out of range` };
    }
    return { ok: true, value, hex: `0x${value.toString(16)}` };
  } catch {
    return { ok: false, error: `${fieldName} is not a valid integer` };
  }
}

/** Validate and normalize a hex data payload to lowercase `0x…`. */
export function normalizeHexData(
  raw: string,
): { ok: true; hex: string; byteLength: number } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "0x" || trimmed === "0X") {
    return { ok: true, hex: "0x", byteLength: 0 };
  }
  const bytes = hexToBytes(trimmed);
  if (bytes === null) {
    return { ok: false, error: "Call data must be valid even-length hexadecimal bytes" };
  }
  return { ok: true, hex: `0x${bytesToHex(bytes)}`, byteLength: bytes.length };
}

export type EncodedPresetResult =
  | { ok: true; entry: string; dataHex: string; byteLength: number }
  | { ok: false; error: string };

/** Encode typed preset fields into canonical Bincode wire hex for `kovanica_call`. */
export function encodePresetArgs(
  presetId: ContractPresetId,
  values: Record<string, string>,
): EncodedPresetResult {
  try {
    switch (presetId) {
      case "name_resolve": {
        const name = (values.name ?? "").trim();
        if (!name) return { ok: false, error: "Name is required" };
        const bytes = encodeBincodeString(name);
        return {
          ok: true,
          entry: "name_resolve",
          dataHex: `0x${bytesToHex(bytes)}`,
          byteLength: bytes.length,
        };
      }

      case "name_register": {
        const name = (values.name ?? "").trim();
        if (!name) return { ok: false, error: "Name is required" };
        const pubkey = parseAddressBytes32(values.pubkey ?? "");
        if (!pubkey) return { ok: false, error: "Owner pubkey must be a valid kvnc…dag address or 32-byte hex" };
        const relays = (values.relayEndpoints ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const bytes = buildNameRegisterCall(name, pubkey, relays);
        return {
          ok: true,
          entry: "name_register",
          dataHex: `0x${bytesToHex(bytes)}`,
          byteLength: bytes.length,
        };
      }

      case "token_transfer": {
        const to = parseAddressBytes32(values.to ?? "");
        if (!to) return { ok: false, error: "Recipient must be a valid kvnc…dag address or 32-byte hex" };
        const amt = parseUintQuantity(values.amount ?? "", "Amount", MAX_U128);
        if (!amt.ok) return amt;
        if (amt.value === null) return { ok: false, error: "Amount is required" };
        const bytes = buildTokenTransferCall(to, amt.value);
        return {
          ok: true,
          entry: "token_transfer",
          dataHex: `0x${bytesToHex(bytes)}`,
          byteLength: bytes.length,
        };
      }

      case "nft_mint": {
        const collection = parseAddressBytes32(values.collection ?? "");
        if (!collection) return { ok: false, error: "Collection ID must be 32 bytes (64 hex or kvnc…dag)" };
        const to = parseAddressBytes32(values.to ?? "");
        if (!to) return { ok: false, error: "Recipient must be a valid kvnc…dag address or 32-byte hex" };
        const tokenId = parseUintQuantity(values.tokenId ?? "", "Token ID", MAX_U128);
        if (!tokenId.ok) return tokenId;
        if (tokenId.value === null) return { ok: false, error: "Token ID is required" };
        const tokenUri = (values.tokenUri ?? "").trim();
        if (!tokenUri) return { ok: false, error: "Token URI is required" };
        const bytes = buildNftMintCall(collection, to, tokenId.value, tokenUri);
        return {
          ok: true,
          entry: "nft_mint",
          dataHex: `0x${bytesToHex(bytes)}`,
          byteLength: bytes.length,
        };
      }

      case "escrow_create": {
        const rawParties = (values.parties ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (rawParties.length === 0) return { ok: false, error: "At least one party address is required" };
        const parties: Uint8Array[] = [];
        for (let i = 0; i < rawParties.length; i += 1) {
          const parsed = parseAddressBytes32(rawParties[i]!);
          if (!parsed) {
            return { ok: false, error: `Party #${i + 1} is not a valid address or 32-byte hex` };
          }
          parties.push(parsed);
        }
        const threshold = parseUintQuantity(values.threshold ?? "", "Threshold", 255n);
        if (!threshold.ok) return threshold;
        if (threshold.value === null || threshold.value < 1n) {
          return { ok: false, error: "Threshold must be between 1 and 255" };
        }
        if (Number(threshold.value) > parties.length) {
          return { ok: false, error: `Threshold (${threshold.value}) cannot exceed party count (${parties.length})` };
        }
        const amount = parseUintQuantity(values.amount ?? "", "Amount", MAX_U64);
        if (!amount.ok) return amount;
        if (amount.value === null) return { ok: false, error: "Amount is required" };
        const deadline = parseUintQuantity(values.deadline ?? "", "Deadline", MAX_U64);
        if (!deadline.ok) return deadline;
        if (deadline.value === null) return { ok: false, error: "Deadline is required" };
        const bytes = buildEscrowCreateCall(
          parties,
          Number(threshold.value),
          amount.value,
          deadline.value,
        );
        return {
          ok: true,
          entry: "escrow_create",
          dataHex: `0x${bytesToHex(bytes)}`,
          byteLength: bytes.length,
        };
      }

      case "htlc_create": {
        const hashlock = parseAddressBytes32(values.hashlock ?? "");
        if (!hashlock) return { ok: false, error: "Hashlock must be a 32-byte hex digest" };
        const timelock = parseUintQuantity(values.timelock ?? "", "Timelock", MAX_U64);
        if (!timelock.ok) return timelock;
        if (timelock.value === null) return { ok: false, error: "Timelock is required" };
        const recipient = parseAddressBytes32(values.recipient ?? "");
        if (!recipient) return { ok: false, error: "Recipient must be a valid kvnc…dag address or 32-byte hex" };
        const bytes = buildHtlcCreateCall(hashlock, timelock.value, recipient);
        return {
          ok: true,
          entry: "htlc_create",
          dataHex: `0x${bytesToHex(bytes)}`,
          byteLength: bytes.length,
        };
      }

      case "vault_create": {
        const owner = parseAddressBytes32(values.owner ?? "");
        if (!owner) return { ok: false, error: "Owner must be a valid kvnc…dag address or 32-byte hex" };
        const lockUntil = parseUintQuantity(values.lockUntil ?? "", "Lock Until", MAX_U64);
        if (!lockUntil.ok) return lockUntil;
        if (lockUntil.value === null) return { ok: false, error: "Lock Until is required" };
        const bytes = buildVaultCreateCall(owner, lockUntil.value);
        return {
          ok: true,
          entry: "vault_create",
          dataHex: `0x${bytesToHex(bytes)}`,
          byteLength: bytes.length,
        };
      }

      case "custom": {
        const entry = (values.entry ?? "").trim();
        const hexRes = normalizeHexData(values.data ?? "");
        if (!hexRes.ok) return hexRes;
        return {
          ok: true,
          entry,
          dataHex: hexRes.hex,
          byteLength: hexRes.byteLength,
        };
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to encode arguments" };
  }
}

// --- RPC Request / Response Types ---

export type ContractCallRequest = {
  to: string;
  entry?: string;
  data?: string;
  from?: string;
  value?: string;
  gas?: string;
};

export type ContractCallEcho = {
  to: string;
  from?: string;
  entry?: string;
  data: string;
  value?: string;
  gas?: string;
};

export type ContractCallSuccessResponse = {
  ok: true;
  reverted: false;
  outputHex: string;
  gasUsed: number | null;
  codeBytes: number | null;
  latencyMs: number;
  source: "testnet" | "local";
  rpcMethod: "kovanica_call";
  call: ContractCallEcho;
};

export type ContractCallErrorResponse = {
  ok: false;
  reverted: boolean;
  error: string;
  codeBytes: number | null;
  latencyMs: number;
  source: "testnet" | "local";
  rpcMethod: "kovanica_call";
  call: ContractCallEcho;
};

export type ContractCallResponse = ContractCallSuccessResponse | ContractCallErrorResponse;

/** Validate and canonicalize a `POST /api/contract_call` request payload. */
export function buildContractCallRequest(
  raw: Partial<Record<keyof ContractCallRequest, unknown>>,
): { ok: true; call: ContractCallEcho } | { ok: false; error: string } {
  const toRaw = typeof raw.to === "string" ? raw.to.trim() : "";
  if (!toRaw) {
    return { ok: false, error: "Contract address (`to`) is required" };
  }
  const toCanonical = toCanonicalAddress(toRaw);
  if (!toCanonical) {
    return {
      ok: false,
      error: "Contract address must be a valid kvnc…dag address or 32-byte hex",
    };
  }

  let fromCanonical: string | undefined;
  const fromRaw = typeof raw.from === "string" ? raw.from.trim() : "";
  if (fromRaw) {
    const parsedFrom = toCanonicalAddress(fromRaw);
    if (!parsedFrom) {
      return {
        ok: false,
        error: "Caller address (`from`) must be a valid kvnc…dag address or 32-byte hex",
      };
    }
    fromCanonical = parsedFrom;
  }

  const entryRaw = typeof raw.entry === "string" ? raw.entry.trim() : "";
  if (entryRaw && !/^[a-zA-Z0-9_]{1,64}$/.test(entryRaw)) {
    return {
      ok: false,
      error: "Entry point name must be 1–64 alphanumeric/underscore characters",
    };
  }

  const dataRaw = typeof raw.data === "string" ? raw.data : "";
  const dataRes = normalizeHexData(dataRaw);
  if (!dataRes.ok) return dataRes;

  const valueRaw =
    typeof raw.value === "number"
      ? String(raw.value)
      : typeof raw.value === "string"
        ? raw.value
        : "";
  const valueRes = parseUintQuantity(valueRaw, "Call value", MAX_U64);
  if (!valueRes.ok) return valueRes;

  const gasRaw =
    typeof raw.gas === "number"
      ? String(raw.gas)
      : typeof raw.gas === "string"
        ? raw.gas
        : "";
  const gasRes = parseUintQuantity(gasRaw, "Gas limit", MAX_U64);
  if (!gasRes.ok) return gasRes;

  const call: ContractCallEcho = {
    to: toCanonical,
    data: dataRes.hex,
  };
  if (fromCanonical) call.from = fromCanonical;
  if (entryRaw) call.entry = entryRaw;
  if (valueRes.hex) call.value = valueRes.hex;
  if (gasRes.hex) call.gas = gasRes.hex;

  return { ok: true, call };
}

// --- Output Decoders ---

export type DecodedNameEntry = {
  ownerHex: string;
  ownerAddress: string;
  pubkeyHex: string;
  pubkeyAddress: string;
  relayEndpoints: string[];
};

/** Encode a `NameEntry` (`owner: [u8;32], pubkey: [u8;32], relay_endpoints: Vec<String>`) to Bincode bytes. */
export function encodeNameEntry(
  owner: Uint8Array,
  pubkey: Uint8Array,
  relayEndpoints: string[],
): Uint8Array {
  if (owner.length !== 32) throw new Error("owner must be 32 bytes");
  if (pubkey.length !== 32) throw new Error("pubkey must be 32 bytes");
  return concatBytes([owner, pubkey, encodeBincodeStringVec(relayEndpoints)]);
}

/** Decode a Bincode `NameEntry` returned by `name_resolve`. */
export function decodeNameEntry(bytes: Uint8Array): DecodedNameEntry | null {
  if (bytes.length < 72) return null;
  const r = new BincodeReader(bytes);
  const owner = r.bytes32();
  const pubkey = r.bytes32();
  if (!owner || !pubkey) return null;
  const relayEndpoints = readBincodeStringVec(r, 64);
  if (relayEndpoints === null || !r.isEof()) return null;

  return {
    ownerHex: bytesToHex(owner),
    ownerAddress: encodeAddress(owner),
    pubkeyHex: bytesToHex(pubkey),
    pubkeyAddress: encodeAddress(pubkey),
    relayEndpoints,
  };
}

function isPrintableUtf8(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    // Allow tab, newline, carriage return, and printable Unicode
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return false;
    }
    if (code === 0x7f) return false;
  }
  return true;
}

export type DecodedOutputPrimary =
  | { kind: "empty"; summary: string }
  | { kind: "name_entry"; value: DecodedNameEntry }
  | { kind: "json"; formatted: string }
  | { kind: "bincode_string"; value: string }
  | { kind: "utf8"; value: string }
  | { kind: "address"; hex: string; canonical: string }
  | { kind: "u64"; value: string }
  | { kind: "u128"; value: string }
  | { kind: "raw"; byteLength: number };

export type DecodedContractOutput = {
  rawHex: string;
  byteLength: number;
  primary: DecodedOutputPrimary;
  /** Secondary decoded views for developer inspection. */
  views: {
    u64Le?: string;
    u128Le?: string;
    address?: string;
    bincodeString?: string;
    utf8?: string;
  };
};

/** Decode raw hex output returned by `kovanica_call` into structured views. */
export function decodeContractOutput(
  outputHex: string,
  entryHint?: string,
): DecodedContractOutput {
  const norm = normalizeHexData(outputHex);
  if (!norm.ok) {
    return {
      rawHex: outputHex,
      byteLength: 0,
      primary: { kind: "raw", byteLength: 0 },
      views: {},
    };
  }

  const bytes = hexToBytes(norm.hex) ?? new Uint8Array(0);
  if (bytes.length === 0) {
    return {
      rawHex: "0x",
      byteLength: 0,
      primary: {
        kind: "empty",
        summary: "Empty return payload (0 bytes / unit `()`)",
      },
      views: {},
    };
  }

  const views: DecodedContractOutput["views"] = {};

  if (bytes.length === 8) {
    const r = new BincodeReader(bytes);
    const val = r.u64();
    if (val !== null) views.u64Le = val.toString();
  }

  if (bytes.length === 16) {
    const r = new BincodeReader(bytes);
    const val = r.u128();
    if (val !== null) views.u128Le = val.toString();
  }

  if (bytes.length === 32) {
    try {
      views.address = encodeAddress(bytes);
    } catch {
      // ignore
    }
  }

  {
    const r = new BincodeReader(bytes);
    const s = readBincodeString(r);
    if (s !== null && r.isEof()) {
      views.bincodeString = s;
    }
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (isPrintableUtf8(decoded)) {
      views.utf8 = decoded;
    }
  } catch {
    // non-UTF-8 binary payload
  }

  // Choose primary representation based on entry hint and byte shape
  const normalizedEntry = (entryHint ?? "").trim().toLowerCase();
  if (normalizedEntry === "name_resolve" || bytes.length >= 72) {
    const nameEntry = decodeNameEntry(bytes);
    if (nameEntry) {
      return {
        rawHex: norm.hex,
        byteLength: bytes.length,
        primary: { kind: "name_entry", value: nameEntry },
        views,
      };
    }
  }

  if (views.utf8) {
    const trimmed = views.utf8.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return {
          rawHex: norm.hex,
          byteLength: bytes.length,
          primary: { kind: "json", formatted: JSON.stringify(parsed, null, 2) },
          views,
        };
      } catch {
        // fall through to utf8
      }
    }
  }

  if (views.bincodeString !== undefined) {
    return {
      rawHex: norm.hex,
      byteLength: bytes.length,
      primary: { kind: "bincode_string", value: views.bincodeString },
      views,
    };
  }

  if (views.address) {
    return {
      rawHex: norm.hex,
      byteLength: bytes.length,
      primary: {
        kind: "address",
        hex: bytesToHex(bytes),
        canonical: views.address,
      },
      views,
    };
  }

  if (views.u64Le !== undefined) {
    return {
      rawHex: norm.hex,
      byteLength: bytes.length,
      primary: { kind: "u64", value: views.u64Le },
      views,
    };
  }

  if (views.u128Le !== undefined) {
    return {
      rawHex: norm.hex,
      byteLength: bytes.length,
      primary: { kind: "u128", value: views.u128Le },
      views,
    };
  }

  if (views.utf8) {
    return {
      rawHex: norm.hex,
      byteLength: bytes.length,
      primary: { kind: "utf8", value: views.utf8 },
      views,
    };
  }

  return {
    rawHex: norm.hex,
    byteLength: bytes.length,
    primary: { kind: "raw", byteLength: bytes.length },
    views,
  };
}

// --- Revert / Error Classification ---

const CONTRACT_ERROR_NAMES: Record<number, string> = {
  [-1]: "Unauthorized (code 0)",
  [-2]: "InsufficientBalance (code 1)",
  [-3]: "InvalidInput (code 2)",
  [-4]: "AlreadyExists (code 3)",
  [-5]: "NotFound (code 4)",
  [-6]: "Expired (code 5)",
  [-7]: "NotExpired (code 6)",
  [-8]: "Overflow (code 7)",
  [-9]: "OutOfGas (code 8)",
  [-10]: "Paused (code 9)",
  [-11]: "InvalidState (code 10)",
  [-12]: "InternalError (code 11)",
};

export type ParsedContractError = {
  category: "revert" | "validation" | "rpc" | "network";
  title: string;
  detail: string;
  contractErrorName?: string;
};

/** Classify an error message from `kovanica_call` into a clear UI diagnosis. */
export function parseContractError(message: string, reverted = false): ParsedContractError {
  const msg = message.trim() || "Unknown execution error";

  // Match negative Wasmi ABI error codes (-1..-12)
  const negMatch = msg.match(/(?:code\s*[:=]?\s*|returned\s+)(-\d{1,2})\b/i);
  if (negMatch) {
    const code = Number(negMatch[1]);
    const name = CONTRACT_ERROR_NAMES[code];
    if (name) {
      return {
        category: "revert",
        title: `Contract Reverted · ${name}`,
        detail: msg,
        contractErrorName: name,
      };
    }
  }

  if (/not\s*found/i.test(msg) && reverted) {
    return {
      category: "revert",
      title: "Contract Reverted · NotFound",
      detail: msg,
      contractErrorName: "NotFound (code 4)",
    };
  }

  if (/unauthorized/i.test(msg) && reverted) {
    return {
      category: "revert",
      title: "Contract Reverted · Unauthorized",
      detail: msg,
      contractErrorName: "Unauthorized (code 0)",
    };
  }

  if (/out of gas|fuel/i.test(msg)) {
    return {
      category: "revert",
      title: "Execution Out of Gas",
      detail: msg,
      contractErrorName: "OutOfGas (code 8)",
    };
  }

  if (reverted || /execution reverted|trap|wasm|entry point|export.*not found/i.test(msg)) {
    return {
      category: "revert",
      title: "Contract Execution Reverted",
      detail: msg,
    };
  }

  if (/invalid params|invalid hex|address/i.test(msg)) {
    return {
      category: "validation",
      title: "Invalid Call Parameters",
      detail: msg,
    };
  }

  if (/503|stalled|unreachable|fetch failed|timeout|abort/i.test(msg)) {
    return {
      category: "network",
      title: "RPC Endpoint Unavailable",
      detail: msg,
    };
  }

  return {
    category: "rpc",
    title: "RPC Call Failed",
    detail: msg,
  };
}

// --- Shareable Deep-Link URLs & Developer Snippets ---

const MAX_DEEP_LINK_QUERY_LENGTH = 2048;
const MAX_DEEP_LINK_ARGS_LENGTH = 1024;
const MAX_DEEP_LINK_FIELD_VALUE_LENGTH = 512;

export type ContractInspectorDeepLinkState = {
  isContractsTab: boolean;
  contractAddress: string | null;
  presetId: ContractPresetId | null;
  fields: Record<string, string>;
};

export function isContractPresetId(value: string): value is ContractPresetId {
  return CONTRACT_PRESETS.some((p) => p.id === value);
}

/**
 * Parse and sanitize URL query parameters for the Explorer Contract Inspector:
 * `?tab=contracts&contract=<addr>&preset=<id>&args=<json-or-params>`
 *
 * Enforces strict length bounds and allowed preset field keys, gracefully
 * ignoring invalid or oversized parameters.
 */
export function parseContractInspectorDeepLink(
  search: string | URLSearchParams,
): ContractInspectorDeepLinkState {
  const empty: ContractInspectorDeepLinkState = {
    isContractsTab: false,
    contractAddress: null,
    presetId: null,
    fields: {},
  };

  let params: URLSearchParams;
  if (typeof search === "string") {
    if (search.length > MAX_DEEP_LINK_QUERY_LENGTH) {
      return empty;
    }
    params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } else {
    const serialized = search.toString();
    if (serialized.length > MAX_DEEP_LINK_QUERY_LENGTH) {
      return empty;
    }
    params = search;
  }

  const tabRaw = (params.get("tab") ?? "").trim().toLowerCase();
  const contractRaw = (params.get("contract") ?? "").trim();
  const presetRaw = (params.get("preset") ?? "").trim();
  const argsRaw = (params.get("args") ?? "").trim();

  let contractAddress: string | null = null;
  if (contractRaw && contractRaw.length <= 128 && toCanonicalAddress(contractRaw) !== null) {
    contractAddress = contractRaw;
  }

  let presetId: ContractPresetId | null = null;
  if (presetRaw && isContractPresetId(presetRaw)) {
    presetId = presetRaw;
  }

  const targetPreset = getContractPreset(presetId ?? "name_resolve");
  const allowedKeys = new Set(targetPreset.fields.map((f) => f.key));
  const fields: Record<string, string> = {};

  if (argsRaw && argsRaw.length <= MAX_DEEP_LINK_ARGS_LENGTH) {
    if (argsRaw.startsWith("{") && argsRaw.endsWith("}")) {
      try {
        const parsed: unknown = JSON.parse(argsRaw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (!allowedKeys.has(k)) continue;
            if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
              const strVal = String(v);
              if (strVal.length <= MAX_DEEP_LINK_FIELD_VALUE_LENGTH) {
                fields[k] = strVal;
              }
            }
          }
        }
      } catch {
        // Ignore malformed JSON
      }
    } else {
      const subParams = new URLSearchParams(argsRaw);
      for (const [k, v] of subParams.entries()) {
        if (!allowedKeys.has(k)) continue;
        if (v.length <= MAX_DEEP_LINK_FIELD_VALUE_LENGTH) {
          fields[k] = v;
        }
      }
    }
  }

  const isContractsTab =
    tabRaw === "contracts" || contractAddress !== null || presetId !== null;

  return {
    isContractsTab,
    contractAddress,
    presetId,
    fields,
  };
}

export type BuildContractDeepLinkOptions = {
  baseUrl?: string;
  contractAddress?: string;
  presetId: ContractPresetId;
  fields: Record<string, string>;
};

/**
 * Serialize current Contract Inspector state into a canonical shareable deep-link URL:
 * `/explorer?tab=contracts&contract=<addr>&preset=<id>&args=<json>`
 */
export function buildContractInspectorDeepLink(
  options: BuildContractDeepLinkOptions,
): string {
  const preset = getContractPreset(options.presetId);
  const params = new URLSearchParams();
  params.set("tab", "contracts");

  const trimmedContract = (options.contractAddress ?? "").trim();
  if (trimmedContract && toCanonicalAddress(trimmedContract) !== null) {
    params.set("contract", trimmedContract);
  }

  params.set("preset", preset.id);

  const sanitizedFields: Record<string, string> = {};
  for (const fieldDef of preset.fields) {
    const val = (options.fields[fieldDef.key] ?? "").trim();
    if (val && val.length <= MAX_DEEP_LINK_FIELD_VALUE_LENGTH) {
      sanitizedFields[fieldDef.key] = val;
    }
  }

  if (Object.keys(sanitizedFields).length > 0) {
    const encodedArgs = JSON.stringify(sanitizedFields);
    if (encodedArgs.length <= MAX_DEEP_LINK_ARGS_LENGTH) {
      params.set("args", encodedArgs);
    }
  }

  const pathWithQuery = `/explorer?${params.toString()}`;
  if (!options.baseUrl) {
    return pathWithQuery;
  }

  try {
    const url = new URL(pathWithQuery, options.baseUrl);
    return url.toString();
  } catch {
    return pathWithQuery;
  }
}

export type ContractSnippetOptions = {
  rpcUrl?: string;
  contractAddress: string;
  presetId: ContractPresetId;
  fields: Record<string, string>;
  from?: string;
  value?: string;
  gas?: string;
};

function escapeSingleQuotesForShell(input: string): string {
  return input.replace(/'/g, "'\\''");
}

/**
 * Build a ready-to-run JSON-RPC `curl -X POST` command invoking `kovanica_call`
 * with the encoded Bincode payload for the current preset and arguments.
 */
export function buildContractCurlSnippet(options: ContractSnippetOptions): string {
  const rpcUrl = (options.rpcUrl ?? "").trim() || "https://testnet.kovanica.online/rpc";
  const encoded = encodePresetArgs(options.presetId, options.fields);
  const toAddr =
    toCanonicalAddress(options.contractAddress.trim()) ||
    options.contractAddress.trim() ||
    "0000000000000000000000000000000000000000000000000000000000000001";

  const callObj: Record<string, string> = {
    to: toAddr,
  };

  const entry = encoded.ok ? encoded.entry : getContractPreset(options.presetId).entry;
  if (entry) {
    callObj.entry = entry;
  }
  callObj.data = encoded.ok ? encoded.dataHex : "0x";

  const fromTrimmed = (options.from ?? "").trim();
  if (fromTrimmed) {
    callObj.from = toCanonicalAddress(fromTrimmed) ?? fromTrimmed;
  }
  const valueRes = parseUintQuantity(options.value ?? "", "value", MAX_U64);
  if (valueRes.ok && valueRes.hex) {
    callObj.value = valueRes.hex;
  }
  const gasRes = parseUintQuantity(options.gas ?? "", "gas", MAX_U64);
  if (gasRes.ok && gasRes.hex) {
    callObj.gas = gasRes.hex;
  }

  const rpcPayload = {
    jsonrpc: "2.0",
    method: "kovanica_call",
    params: [callObj],
    id: 1,
  };

  const jsonBody = escapeSingleQuotesForShell(JSON.stringify(rpcPayload));
  return [
    `curl -X POST '${escapeSingleQuotesForShell(rpcUrl)}' \\`,
    `  -H 'content-type: application/json' \\`,
    `  -d '${jsonBody}'`,
  ].join("\n");
}

/**
 * Build a ready-to-run TypeScript snippet using `kovanica-sdk` (`KovanicaClient`
 * and `estimateAndBuildCall`) matching the current preset and arguments.
 */
export function buildContractSdkSnippet(options: ContractSnippetOptions): string {
  const rpcUrl = (options.rpcUrl ?? "").trim() || "https://testnet.kovanica.online/rpc";
  const encoded = encodePresetArgs(options.presetId, options.fields);
  const toAddr =
    toCanonicalAddress(options.contractAddress.trim()) ||
    options.contractAddress.trim() ||
    "0000000000000000000000000000000000000000000000000000000000000001";
  const entry =
    (encoded.ok ? encoded.entry : getContractPreset(options.presetId).entry) || "call";
  const dataHex = encoded.ok ? encoded.dataHex : "0x";

  const callProps: string[] = [
    `  to: ${JSON.stringify(toAddr)},`,
    `  entry: ${JSON.stringify(entry)},`,
    `  data: ${JSON.stringify(dataHex)},`,
  ];

  const fromTrimmed = (options.from ?? "").trim();
  if (fromTrimmed) {
    callProps.push(`  from: ${JSON.stringify(toCanonicalAddress(fromTrimmed) ?? fromTrimmed)},`);
  }
  const valueRes = parseUintQuantity(options.value ?? "", "value", MAX_U64);
  if (valueRes.ok && valueRes.hex) {
    callProps.push(`  value: ${JSON.stringify(valueRes.hex)},`);
  }
  const gasRes = parseUintQuantity(options.gas ?? "", "gas", MAX_U64);
  if (gasRes.ok && gasRes.hex) {
    callProps.push(`  gas: ${JSON.stringify(gasRes.hex)},`);
  }

  return [
    `import { KovanicaClient, estimateAndBuildCall } from "kovanica-sdk";`,
    ``,
    `const client = new KovanicaClient({ rpcUrl: ${JSON.stringify(rpcUrl)} });`,
    `const callRequest = {`,
    ...callProps,
    `};`,
    ``,
    `// 1. Read-only Wasmi simulation via kovanica_call`,
    `const outputHex = await client.call(callRequest);`,
    `console.log("kovanica_call output:", outputHex);`,
    ``,
    `// 2. Estimate gas and build a call transaction descriptor`,
    `const prepared = await estimateAndBuildCall(client, callRequest);`,
    `console.log("Estimated gas:", prepared.gasLimit);`,
  ].join("\n");
}

// --- Contract Storage Slot & Bincode State Reader (`kovanica_getStorageAt`) ---

export type StorageSlotPresetId =
  | "name"
  | "token_meta"
  | "nft_meta"
  | "escrow"
  | "htlc"
  | "vault"
  | "multisig_state"
  | "raw_slot";

export type StorageRecordSchema =
  | "auto"
  | "name_entry"
  | "token_meta"
  | "escrow"
  | "htlc"
  | "vault"
  | "multisig";

export type StorageSlotPreset = {
  id: StorageSlotPresetId;
  label: string;
  prefix: string | null;
  fixedKey: string | null;
  placeholder: string;
  defaultInput: string;
  description: string;
  schemaHint: StorageRecordSchema;
};

export const STORAGE_SLOT_PRESETS: readonly StorageSlotPreset[] = [
  {
    id: "name",
    label: "name:<name>",
    prefix: "name:",
    fixedKey: null,
    placeholder: "alice",
    defaultInput: "alice",
    description: "Comms Name Registry record (`blake3('name:' + name)`) decoded as Bincode NameEntry.",
    schemaHint: "name_entry",
  },
  {
    id: "token_meta",
    label: "token:meta",
    prefix: null,
    fixedKey: "token:meta",
    placeholder: "token:meta",
    defaultInput: "",
    description: "KVP-102 token metadata & supply record (`blake3('token:meta')`).",
    schemaHint: "token_meta",
  },
  {
    id: "nft_meta",
    label: "nft:meta",
    prefix: null,
    fixedKey: "nft:meta",
    placeholder: "nft:meta",
    defaultInput: "",
    description: "KVP-106 NFT collection metadata record (`blake3('nft:meta')`).",
    schemaHint: "token_meta",
  },
  {
    id: "escrow",
    label: "escrow:<id>",
    prefix: "escrow:",
    fixedKey: null,
    placeholder: "1",
    defaultInput: "1",
    description: "Multi-party M-of-N escrow state (`blake3('escrow:' + id)`).",
    schemaHint: "escrow",
  },
  {
    id: "htlc",
    label: "htlc:<id>",
    prefix: "htlc:",
    fixedKey: null,
    placeholder: "1",
    defaultInput: "1",
    description: "Hash Time-Locked Contract state (`blake3('htlc:' + id)`).",
    schemaHint: "htlc",
  },
  {
    id: "vault",
    label: "vault:<id>",
    prefix: "vault:",
    fixedKey: null,
    placeholder: "1",
    defaultInput: "1",
    description: "Time-locked KVNC vault state (`blake3('vault:' + id)`).",
    schemaHint: "vault",
  },
  {
    id: "multisig_state",
    label: "multisig:state",
    prefix: null,
    fixedKey: "multisig:state",
    placeholder: "multisig:state",
    defaultInput: "",
    description: "On-chain multisig owners & threshold state (`blake3('multisig:state')`).",
    schemaHint: "multisig",
  },
  {
    id: "raw_slot",
    label: "Raw Key / 32-Byte Hex",
    prefix: null,
    fixedKey: null,
    placeholder: "0x… (64 hex chars) or UTF-8 key e.g. kvnc/v1/state",
    defaultInput: "name:alice",
    description: "Query any 32-byte hex storage slot directly or hash an arbitrary UTF-8 storage key with BLAKE3.",
    schemaHint: "auto",
  },
];

export function getStorageSlotPreset(id: StorageSlotPresetId): StorageSlotPreset {
  return STORAGE_SLOT_PRESETS.find((p) => p.id === id) ?? STORAGE_SLOT_PRESETS[0]!;
}

export type DerivedStorageSlot =
  | {
      ok: true;
      slotHex: string;
      rawKey: string | null;
      derivation: "blake3" | "raw32";
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Compute a canonical 32-byte storage slot hex (`0x` + 64 lowercase hex chars).
 *
 * - If `keyOrSlot` is a 32-byte hex string (64 hex chars, optional `0x` prefix),
 *   returns it normalized as `derivation: "raw32"`.
 * - If `keyOrSlot` starts with `0x`/`0X` but is not 64 hex chars, rejects it.
 * - Otherwise hashes the UTF-8 string bytes with BLAKE3 (`blake3(utf8_bytes)`),
 *   matching Kovanica's host storage key derivation.
 */
export function computeStorageSlotHex(keyOrSlot: string): DerivedStorageSlot {
  const trimmed = keyOrSlot.trim();
  if (!trimmed) {
    return { ok: false, error: "Storage key or 32-byte hex slot is required" };
  }

  if (/^(?:0[xX])?[0-9a-fA-F]{64}$/.test(trimmed)) {
    const clean = trimmed.replace(/^0[xX]/, "").toLowerCase();
    return {
      ok: true,
      slotHex: `0x${clean}`,
      rawKey: null,
      derivation: "raw32",
    };
  }

  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return {
      ok: false,
      error: "Raw hex storage slot must be exactly 32 bytes (64 hex characters)",
    };
  }

  const keyBytes = new TextEncoder().encode(trimmed);
  const digest = blake3(keyBytes);
  return {
    ok: true,
    slotHex: `0x${bytesToHex(digest)}`,
    rawKey: trimmed,
    derivation: "blake3",
  };
}

/** Derive the canonical storage slot for a storage preset and user input value. */
export function derivePresetStorageSlot(
  presetId: StorageSlotPresetId,
  inputValue: string,
): DerivedStorageSlot {
  const preset = getStorageSlotPreset(presetId);
  if (preset.fixedKey) {
    return computeStorageSlotHex(preset.fixedKey);
  }
  const trimmed = inputValue.trim();
  if (preset.prefix) {
    if (!trimmed) {
      return { ok: false, error: `Identifier after '${preset.prefix}' is required` };
    }
    const normalizedKey = trimmed.startsWith(preset.prefix)
      ? trimmed
      : `${preset.prefix}${trimmed}`;
    return computeStorageSlotHex(normalizedKey);
  }
  return computeStorageSlotHex(trimmed);
}

// --- Storage RPC Request / Response Types ---

export type ContractStorageRequest = {
  contract: string;
  slot?: string;
  key?: string;
  schemaHint?: StorageRecordSchema;
};

export type ContractStorageQuery = {
  contract: string;
  slotHex: string;
  rawKey: string | null;
  derivation: "blake3" | "raw32";
  schemaHint: StorageRecordSchema;
};

export type ContractStorageResponse = {
  ok: true;
  storageHex: string;
  isEmpty: boolean;
  byteLength: number;
  codeBytes: number | null;
  latencyMs: number;
  source: "testnet" | "local";
  rpcMethod: "kovanica_getStorageAt";
  query: ContractStorageQuery;
};

/** Validate and canonicalize a `POST /api/contract_storage` request payload. */
export function buildContractStorageRequest(
  raw: Partial<Record<string, unknown>>,
): { ok: true; query: ContractStorageQuery } | { ok: false; error: string } {
  const contractRaw =
    typeof raw.contract === "string"
      ? raw.contract.trim()
      : typeof raw.to === "string"
        ? raw.to.trim()
        : "";
  if (!contractRaw) {
    return { ok: false, error: "Contract address (`contract`) is required" };
  }
  const contractCanonical = toCanonicalAddress(contractRaw);
  if (!contractCanonical) {
    return {
      ok: false,
      error: "Contract address must be a valid kvnc…dag address or 32-byte hex",
    };
  }

  const keyRaw = typeof raw.key === "string" ? raw.key.trim() : "";
  const slotRaw = typeof raw.slot === "string" ? raw.slot.trim() : "";
  const targetInput = slotRaw || keyRaw;
  if (!targetInput) {
    return { ok: false, error: "Storage `key` or 32-byte `slot` is required" };
  }

  let derived: DerivedStorageSlot;
  if (slotRaw && keyRaw) {
    // If both are passed, validate `slotRaw` as a 32-byte slot or derive from `keyRaw`
    const slotCheck = computeStorageSlotHex(slotRaw);
    if (!slotCheck.ok) return slotCheck;
    derived = {
      ok: true,
      slotHex: slotCheck.slotHex,
      rawKey: keyRaw,
      derivation: "blake3",
    };
  } else {
    derived = computeStorageSlotHex(targetInput);
  }

  if (!derived.ok) return derived;

  const hintRaw = typeof raw.schemaHint === "string" ? raw.schemaHint.trim() : "auto";
  const validHints: StorageRecordSchema[] = [
    "auto",
    "name_entry",
    "token_meta",
    "escrow",
    "htlc",
    "vault",
    "multisig",
  ];
  const schemaHint: StorageRecordSchema = validHints.includes(hintRaw as StorageRecordSchema)
    ? (hintRaw as StorageRecordSchema)
    : "auto";

  return {
    ok: true,
    query: {
      contract: contractCanonical,
      slotHex: derived.slotHex,
      rawKey: derived.rawKey,
      derivation: derived.derivation,
      schemaHint,
    },
  };
}

// --- Storage Bincode Encoders & Decoders ---

export type DecodedTokenMetaRecord = {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  ownerHex: string;
  ownerAddress: string;
  paused: boolean;
  holdersCount?: number;
};

export type DecodedEscrowRecord = {
  partiesHex: string[];
  partiesAddresses: string[];
  threshold: number;
  amount: string;
  deadline: string;
};

export type DecodedHtlcRecord = {
  hashlockHex: string;
  timelock: string;
  recipientHex: string;
  recipientAddress: string;
  amount?: string;
};

export type DecodedVaultRecord = {
  ownerHex: string;
  ownerAddress: string;
  lockUntil: string;
  amount?: string;
};

export type DecodedMultisigRecord = {
  ownersHex: string[];
  ownersAddresses: string[];
  threshold: number;
};

/** Encode a compact Bincode `TokenMetadata` record for storage inspection and testing. */
export function encodeTokenMetadataStorage(params: {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint | number;
  owner: Uint8Array;
  paused?: boolean;
}): Uint8Array {
  if (params.owner.length !== 32) throw new Error("owner must be 32 bytes");
  return concatBytes([
    encodeBincodeString(params.name),
    encodeBincodeString(params.symbol),
    Uint8Array.of(params.decimals & 0xff),
    u128le(params.totalSupply),
    params.owner,
    Uint8Array.of(params.paused ? 1 : 0),
  ]);
}

/** Decode either a full KVP-102 `TokenState` or a compact Bincode `TokenMetadata` storage record. */
export function decodeTokenMetadataStorage(bytes: Uint8Array): DecodedTokenMetaRecord | null {
  // 1. Try full KVP-102 token state layout (with minter, balances map, allowances map, paused, icon)
  const fullToken = decodeToken(bytes);
  if (fullToken) {
    const ownerBytes = hexToBytes(fullToken.owner);
    return {
      name: fullToken.name,
      symbol: fullToken.symbol,
      decimals: fullToken.decimals,
      totalSupply: fullToken.totalSupply.toString(),
      ownerHex: fullToken.owner,
      ownerAddress: ownerBytes ? encodeAddress(ownerBytes) : fullToken.owner,
      paused: fullToken.paused,
      holdersCount: fullToken.balances.size,
    };
  }

  // 2. Try compact Bincode TokenMetadata: (name: String, symbol: String, decimals: u8, total_supply: u128, owner: [u8;32], paused?: bool)
  const r = new BincodeReader(bytes);
  const name = readBincodeString(r, 256);
  if (!name) return null;
  const symbol = readBincodeString(r, 64);
  if (!symbol) return null;
  const decimals = r.u8();
  if (decimals === null || decimals > 36) return null;
  const totalSupply = r.u128();
  if (totalSupply === null) return null;
  const owner = r.bytes32();
  if (!owner) return null;

  let paused = false;
  if (r.remaining() === 1) {
    const p = r.u8();
    if (p === null || (p !== 0 && p !== 1)) return null;
    paused = p === 1;
  }
  if (!r.isEof()) return null;

  return {
    name,
    symbol,
    decimals,
    totalSupply: totalSupply.toString(),
    ownerHex: bytesToHex(owner),
    ownerAddress: encodeAddress(owner),
    paused,
  };
}

/** Encode a Bincode `Escrow` storage record. */
export function encodeEscrowStorage(
  parties: Uint8Array[],
  threshold: number,
  amount: bigint | number,
  deadline: bigint | number,
): Uint8Array {
  return buildEscrowCreateCall(parties, threshold, amount, deadline);
}

/** Decode a Bincode `Escrow` storage record. */
export function decodeEscrowStorage(bytes: Uint8Array): DecodedEscrowRecord | null {
  const dec = decodeEscrowCreateArgs(bytes);
  if (!dec) return null;
  return {
    partiesHex: dec.parties,
    partiesAddresses: dec.partiesAddresses ?? dec.parties,
    threshold: dec.threshold,
    amount: dec.amount.toString(),
    deadline: dec.deadline.toString(),
  };
}

/** Encode a Bincode `HTLC` storage record. */
export function encodeHtlcStorage(
  hashlock: Uint8Array,
  timelock: bigint | number,
  recipient: Uint8Array,
  amount?: bigint | number,
): Uint8Array {
  if (amount !== undefined) {
    if (hashlock.length !== 32 || recipient.length !== 32) {
      throw new Error("hashlock and recipient must be 32 bytes");
    }
    return concatBytes([recipient, u128le(amount), hashlock, u64le(timelock)]);
  }
  return buildHtlcCreateCall(hashlock, timelock, recipient);
}

/** Decode a Bincode `HTLC` storage record. */
export function decodeHtlcStorage(bytes: Uint8Array): DecodedHtlcRecord | null {
  const dec = decodeHtlcCreateArgs(bytes);
  if (!dec) return null;
  return {
    hashlockHex: dec.hashlock,
    timelock: dec.timelock.toString(),
    recipientHex: dec.recipient,
    recipientAddress: dec.recipientAddress ?? dec.recipient,
    amount: dec.amount !== undefined ? dec.amount.toString() : undefined,
  };
}

/** Encode a Bincode `Vault` storage record. */
export function encodeVaultStorage(
  owner: Uint8Array,
  lockUntil: bigint | number,
  amount?: bigint | number,
): Uint8Array {
  return buildVaultCreateCall(owner, lockUntil, amount);
}

/** Decode a Bincode `Vault` storage record. */
export function decodeVaultStorage(bytes: Uint8Array): DecodedVaultRecord | null {
  const dec = decodeVaultCreateArgs(bytes);
  if (!dec) return null;
  return {
    ownerHex: dec.owner,
    ownerAddress: dec.ownerAddress ?? dec.owner,
    lockUntil: dec.lockUntil.toString(),
    amount: dec.amount !== undefined ? dec.amount.toString() : undefined,
  };
}

/** Encode a Bincode `Multisig` storage record (`owners: Vec<[u8;32]>, threshold: u32`). */
export function encodeMultisigStorage(owners: Uint8Array[], threshold: number): Uint8Array {
  return concatBytes([encodeBincodeBytes32Vec(owners), u32le(threshold)]);
}

/** Decode a Bincode `Multisig` storage record. */
export function decodeMultisigStorage(bytes: Uint8Array): DecodedMultisigRecord | null {
  const dec = decodeMultisigCreateArgs(bytes);
  if (!dec) return null;
  return {
    ownersHex: dec.owners,
    ownersAddresses: dec.ownersAddresses ?? dec.owners,
    threshold: dec.threshold,
  };
}

export type DecodedStorageRecord =
  | { kind: "empty"; isZeroBytes32: boolean; summary: string }
  | { kind: "name_entry"; value: DecodedNameEntry }
  | { kind: "token_meta"; value: DecodedTokenMetaRecord }
  | { kind: "escrow"; value: DecodedEscrowRecord }
  | { kind: "htlc"; value: DecodedHtlcRecord }
  | { kind: "vault"; value: DecodedVaultRecord }
  | { kind: "multisig"; value: DecodedMultisigRecord }
  | { kind: "address"; hex: string; canonical: string }
  | { kind: "u64"; value: string }
  | { kind: "u128"; value: string }
  | { kind: "utf8"; value: string }
  | { kind: "raw"; byteLength: number };

export type DecodedStorageResult = {
  rawHex: string;
  byteLength: number;
  isEmpty: boolean;
  isZeroBytes32: boolean;
  record: DecodedStorageRecord;
};

/** Check whether a byte buffer is empty (0 bytes) or 32 zero bytes (`0x00..00`). */
export function isStorageBytesEmpty(bytes: Uint8Array): {
  isEmpty: boolean;
  isZeroBytes32: boolean;
} {
  if (bytes.length === 0) {
    return { isEmpty: true, isZeroBytes32: false };
  }
  if (bytes.length === 32 && bytes.every((b) => b === 0)) {
    return { isEmpty: true, isZeroBytes32: true };
  }
  return { isEmpty: false, isZeroBytes32: false };
}

/**
 * Decode raw storage hex returned by `kovanica_getStorageAt` into a typed
 * Kovanica Bincode record (`NameEntry`, `TokenMetadata`, `Escrow`, `HTLC`,
 * `Vault`, `Multisig`, primitive values, or empty slot).
 */
export function decodeContractStorageValue(
  storageHex: string,
  schemaHint: StorageRecordSchema = "auto",
): DecodedStorageResult {
  const norm = normalizeHexData(storageHex);
  if (!norm.ok) {
    return {
      rawHex: storageHex,
      byteLength: 0,
      isEmpty: false,
      isZeroBytes32: false,
      record: { kind: "raw", byteLength: 0 },
    };
  }

  const bytes = hexToBytes(norm.hex) ?? new Uint8Array(0);
  const emptyCheck = isStorageBytesEmpty(bytes);
  if (emptyCheck.isEmpty) {
    return {
      rawHex: norm.hex,
      byteLength: bytes.length,
      isEmpty: true,
      isZeroBytes32: emptyCheck.isZeroBytes32,
      record: {
        kind: "empty",
        isZeroBytes32: emptyCheck.isZeroBytes32,
        summary: emptyCheck.isZeroBytes32
          ? "Unset storage slot (32 zero bytes)"
          : "Empty storage slot (0x — no value stored at this key)",
      },
    };
  }

  // 1. Honor explicit schema hint first when valid
  if (schemaHint === "name_entry") {
    const entry = decodeNameEntry(bytes);
    if (entry) {
      return {
        rawHex: norm.hex,
        byteLength: bytes.length,
        isEmpty: false,
        isZeroBytes32: false,
        record: { kind: "name_entry", value: entry },
      };
    }
  } else if (schemaHint === "token_meta") {
    const meta = decodeTokenMetadataStorage(bytes);
    if (meta) {
      return {
        rawHex: norm.hex,
        byteLength: bytes.length,
        isEmpty: false,
        isZeroBytes32: false,
        record: { kind: "token_meta", value: meta },
      };
    }
  } else if (schemaHint === "escrow") {
    const escrow = decodeEscrowStorage(bytes);
    if (escrow) {
      return {
        rawHex: norm.hex,
        byteLength: bytes.length,
        isEmpty: false,
        isZeroBytes32: false,
        record: { kind: "escrow", value: escrow },
      };
    }
  } else if (schemaHint === "htlc") {
    const htlc = decodeHtlcStorage(bytes);
    if (htlc) {
      return {
        rawHex: norm.hex,
        byteLength: bytes.length,
        isEmpty: false,
        isZeroBytes32: false,
        record: { kind: "htlc", value: htlc },
      };
    }
  } else if (schemaHint === "vault") {
    const vault = decodeVaultStorage(bytes);
    if (vault) {
      return {
        rawHex: norm.hex,
        byteLength: bytes.length,
        isEmpty: false,
        isZeroBytes32: false,
        record: { kind: "vault", value: vault },
      };
    }
  } else if (schemaHint === "multisig") {
    const ms = decodeMultisigStorage(bytes);
    if (ms) {
      return {
        rawHex: norm.hex,
        byteLength: bytes.length,
        isEmpty: false,
        isZeroBytes32: false,
        record: { kind: "multisig", value: ms },
      };
    }
  }

  // 2. Auto-detect Bincode record layout
  const tokenMeta = decodeTokenMetadataStorage(bytes);
  if (tokenMeta) {
    return {
      rawHex: norm.hex,
      byteLength: bytes.length,
      isEmpty: false,
      isZeroBytes32: false,
      record: { kind: "token_meta", value: tokenMeta },
    };
  }

  const nameEntry = decodeNameEntry(bytes);
  if (nameEntry) {
    return {
      rawHex: norm.hex,
      byteLength: bytes.length,
      isEmpty: false,
      isZeroBytes32: false,
      record: { kind: "name_entry", value: nameEntry },
    };
  }

  const escrow = decodeEscrowStorage(bytes);
  if (escrow) {
    return {
      rawHex: norm.hex,
      byteLength: bytes.length,
      isEmpty: false,
      isZeroBytes32: false,
      record: { kind: "escrow", value: escrow },
    };
  }

  const htlc = decodeHtlcStorage(bytes);
  if (htlc) {
    return {
      rawHex: norm.hex,
      byteLength: bytes.length,
      isEmpty: false,
      isZeroBytes32: false,
      record: { kind: "htlc", value: htlc },
    };
  }

  const vault = decodeVaultStorage(bytes);
  if (vault) {
    return {
      rawHex: norm.hex,
      byteLength: bytes.length,
      isEmpty: false,
      isZeroBytes32: false,
      record: { kind: "vault", value: vault },
    };
  }

  const multisig = decodeMultisigStorage(bytes);
  if (multisig) {
    return {
      rawHex: norm.hex,
      byteLength: bytes.length,
      isEmpty: false,
      isZeroBytes32: false,
      record: { kind: "multisig", value: multisig },
    };
  }

  // 3. Fallback primitives (32-byte address, u64, u128, UTF-8, raw hex)
  if (bytes.length === 32) {
    try {
      return {
        rawHex: norm.hex,
        byteLength: 32,
        isEmpty: false,
        isZeroBytes32: false,
        record: {
          kind: "address",
          hex: bytesToHex(bytes),
          canonical: encodeAddress(bytes),
        },
      };
    } catch {
      // ignore
    }
  }

  if (bytes.length === 8) {
    const val = new BincodeReader(bytes).u64();
    if (val !== null) {
      return {
        rawHex: norm.hex,
        byteLength: 8,
        isEmpty: false,
        isZeroBytes32: false,
        record: { kind: "u64", value: val.toString() },
      };
    }
  }

  if (bytes.length === 16) {
    const val = new BincodeReader(bytes).u128();
    if (val !== null) {
      return {
        rawHex: norm.hex,
        byteLength: 16,
        isEmpty: false,
        isZeroBytes32: false,
        record: { kind: "u128", value: val.toString() },
      };
    }
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (isPrintableUtf8(decoded)) {
      return {
        rawHex: norm.hex,
        byteLength: bytes.length,
        isEmpty: false,
        isZeroBytes32: false,
        record: { kind: "utf8", value: decoded },
      };
    }
  } catch {
    // non-UTF-8 binary
  }

  return {
    rawHex: norm.hex,
    byteLength: bytes.length,
    isEmpty: false,
    isZeroBytes32: false,
    record: { kind: "raw", byteLength: bytes.length },
  };
}

