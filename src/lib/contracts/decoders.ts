/**
 * Canonical Smart Contract Call Decoders & Bincode Deserializers.
 *
 * Implements deterministic Bincode decoding for canonical Kovanica Wasmi contract entry points:
 * - name_register(name: String, pubkey: [u8; 32], relay_endpoints: Vec<String>)
 * - htlc_create(hashlock: [u8; 32], timelock: u64, recipient: [u8; 32])
 * - nft_mint(collection: [u8; 32], to: [u8; 32], token_id: u128, token_uri: String)
 * - escrow_create(parties: Vec<[u8; 32]>, threshold: u8|u32, amount: u64|u128, deadline: u64)
 * - token_transfer(to: [u8; 32], amount: u128)
 * - vault_create(owner: [u8; 32], lock_until: u64) / (beneficiary, amount, schedule)
 *
 * All decoders fail safely on truncated, malformed, or hostile inputs (no panics, no unhandled exceptions).
 */

import { encodeAddress } from "../wallet/address";

// --- Binary Hex Helpers ---

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length === 0) return new Uint8Array(0);
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    return null;
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const val = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(val)) return null;
    bytes[i] = val;
  }
  return bytes;
}

// --- Safe Bincode Stream Reader ---

export const MAX_STRING_BYTES = 1024 * 1024; // 1 MiB safeguard
export const MAX_VECTOR_COUNT = 10_000; // 10,000 items safeguard

export class BincodeReader {
  private pos = 0;
  private readonly buffer: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.buffer = bytes;
  }

  remaining(): number {
    return this.buffer.length - this.pos;
  }

  getPos(): number {
    return this.pos;
  }

  isEof(): boolean {
    return this.pos >= this.buffer.length;
  }

  private want(n: number): boolean {
    return n >= 0 && this.pos + n <= this.buffer.length;
  }

  u8(): number | null {
    if (!this.want(1)) return null;
    return this.buffer[this.pos++]!;
  }

  u16(): number | null {
    if (!this.want(2)) return null;
    const v = this.buffer[this.pos]! | (this.buffer[this.pos + 1]! << 8);
    this.pos += 2;
    return v;
  }

  u32(): number | null {
    if (!this.want(4)) return null;
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.pos, 4);
    const v = view.getUint32(0, true);
    this.pos += 4;
    return v;
  }

  u64(): bigint | null {
    if (!this.want(8)) return null;
    let value = 0n;
    for (let i = 7; i >= 0; i -= 1) {
      value = (value << 8n) | BigInt(this.buffer[this.pos + i]!);
    }
    this.pos += 8;
    return value;
  }

  u128(): bigint | null {
    if (!this.want(16)) return null;
    let value = 0n;
    for (let i = 15; i >= 0; i -= 1) {
      value = (value << 8n) | BigInt(this.buffer[this.pos + i]!);
    }
    this.pos += 16;
    return value;
  }

  bytes(n: number): Uint8Array | null {
    if (!this.want(n)) return null;
    const out = this.buffer.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  bytes32(): Uint8Array | null {
    return this.bytes(32);
  }
}

// --- Canonical Bincode Primitives ---

/**
 * Reads an 8-byte LE length-prefixed UTF-8 string.
 * Returns null if truncated, exceeding maxBytes, or contains invalid UTF-8.
 */
export function readBincodeString(
  reader: BincodeReader,
  maxBytes = MAX_STRING_BYTES,
): string | null {
  const len = reader.u64();
  if (len === null) return null;
  if (len > BigInt(maxBytes) || len > BigInt(reader.remaining())) return null;

  const raw = reader.bytes(Number(len));
  if (raw === null) return null;

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return null;
  }
}

/**
 * Reads an 8-byte LE count-prefixed vector of 32-byte arrays (`Vec<[u8; 32]>`).
 */
export function readBincodeBytes32Vec(
  reader: BincodeReader,
  maxItems = MAX_VECTOR_COUNT,
): Uint8Array[] | null {
  const count = reader.u64();
  if (count === null) return null;
  if (count > BigInt(maxItems)) return null;
  if (count * 32n > BigInt(reader.remaining())) return null;

  const n = Number(count);
  const items: Uint8Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const item = reader.bytes32();
    if (item === null) return null;
    items[i] = item;
  }
  return items;
}

/**
 * Reads an 8-byte LE count-prefixed vector of Bincode strings (`Vec<String>`).
 */
export function readBincodeStringVec(
  reader: BincodeReader,
  maxItems = MAX_VECTOR_COUNT,
): string[] | null {
  const count = reader.u64();
  if (count === null) return null;
  if (count > BigInt(maxItems)) return null;
  // Each string takes at least 8 bytes for its length prefix
  if (count * 8n > BigInt(reader.remaining())) return null;

  const n = Number(count);
  const items: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = readBincodeString(reader);
    if (s === null) return null;
    items[i] = s;
  }
  return items;
}

export function readU32(reader: BincodeReader): number | null {
  return reader.u32();
}

export function readU64(reader: BincodeReader): bigint | null {
  return reader.u64();
}

export function readU128(reader: BincodeReader): bigint | null {
  return reader.u128();
}

// --- Structured Decoded Contract Types ---

export type NameRegisterParams = {
  name: string;
  pubkey: string;
  pubkeyAddress?: string;
  relayEndpoints: string[];
};

export type HtlcCreateParams = {
  hashlock: string;
  timelock: bigint;
  recipient: string;
  recipientAddress?: string;
  amount?: bigint;
};

export type NftMintParams = {
  collection: string;
  to: string;
  toAddress?: string;
  tokenId: bigint;
  tokenUri: string;
};

export type EscrowCreateParams = {
  parties: string[];
  partiesAddresses?: string[];
  threshold: number;
  amount: bigint;
  deadline: bigint;
};

export type TokenTransferParams = {
  to: string;
  toAddress?: string;
  amount: bigint;
};

export type VaultCreateParams = {
  owner: string;
  ownerAddress?: string;
  lockUntil: bigint;
  amount?: bigint;
};

export type MultisigCreateParams = {
  owners: string[];
  ownersAddresses?: string[];
  threshold: number;
};

export type DecodedContractCall =
  | {
      recognized: true;
      method: "name_register";
      params: NameRegisterParams;
      rawHex: string;
    }
  | {
      recognized: true;
      method: "htlc_create";
      params: HtlcCreateParams;
      rawHex: string;
    }
  | {
      recognized: true;
      method: "nft_mint";
      params: NftMintParams;
      rawHex: string;
    }
  | {
      recognized: true;
      method: "escrow_create";
      params: EscrowCreateParams;
      rawHex: string;
    }
  | {
      recognized: true;
      method: "token_transfer";
      params: TokenTransferParams;
      rawHex: string;
    }
  | {
      recognized: true;
      method: "vault_create";
      params: VaultCreateParams;
      rawHex: string;
    }
  | {
      recognized: true;
      method: "multisig_create";
      params: MultisigCreateParams;
      rawHex: string;
    }
  | {
      recognized: false;
      method?: string;
      rawHex: string;
      error?: string;
    };

function tryFormatAddress(bytes: Uint8Array): string | undefined {
  try {
    return encodeAddress(bytes);
  } catch {
    return undefined;
  }
}

// --- Specific Entry Point Decoders ---

export function decodeNameRegisterArgs(bytes: Uint8Array): NameRegisterParams | null {
  const r = new BincodeReader(bytes);
  const name = readBincodeString(r);
  if (name === null) return null;

  const pubkey = r.bytes32();
  if (pubkey === null) return null;

  const relayEndpoints = readBincodeStringVec(r);
  if (relayEndpoints === null) return null;

  if (!r.isEof()) return null;

  return {
    name,
    pubkey: bytesToHex(pubkey),
    pubkeyAddress: tryFormatAddress(pubkey),
    relayEndpoints,
  };
}

export function decodeHtlcCreateArgs(bytes: Uint8Array): HtlcCreateParams | null {
  // Wire Layout A (72 bytes): (hashlock: [u8; 32], timelock: u64, recipient: [u8; 32])
  if (bytes.length === 72) {
    const r = new BincodeReader(bytes);
    const hashlock = r.bytes32();
    const timelock = r.u64();
    const recipient = r.bytes32();
    if (hashlock && timelock !== null && recipient && r.isEof()) {
      return {
        hashlock: bytesToHex(hashlock),
        timelock,
        recipient: bytesToHex(recipient),
        recipientAddress: tryFormatAddress(recipient),
      };
    }
  }

  // Wire Layout B (88 bytes): (claimer: [u8; 32], amount: u128, hash_lock: [u8; 32], expiry: u64)
  if (bytes.length === 88) {
    const r = new BincodeReader(bytes);
    const claimer = r.bytes32();
    const amount = r.u128();
    const hashlock = r.bytes32();
    const expiry = r.u64();
    if (claimer && amount !== null && hashlock && expiry !== null && r.isEof()) {
      return {
        hashlock: bytesToHex(hashlock),
        timelock: expiry,
        recipient: bytesToHex(claimer),
        recipientAddress: tryFormatAddress(claimer),
        amount,
      };
    }
  }

  return null;
}

export function decodeNftMintArgs(bytes: Uint8Array): NftMintParams | null {
  // Wire Layout: (collection: [u8; 32], to: [u8; 32], token_id: u128, token_uri: String)
  const r = new BincodeReader(bytes);
  const collection = r.bytes32();
  if (!collection) return null;
  const to = r.bytes32();
  if (!to) return null;

  // Try u128 for tokenId first (canonical in kovanica-sdk and execution crate)
  const tokenId = r.u128();
  if (tokenId === null) return null;

  const tokenUri = readBincodeString(r);
  if (tokenUri === null) return null;

  if (!r.isEof()) return null;

  return {
    collection: bytesToHex(collection),
    to: bytesToHex(to),
    toAddress: tryFormatAddress(to),
    tokenId,
    tokenUri,
  };
}

export function decodeEscrowCreateArgs(bytes: Uint8Array): EscrowCreateParams | null {
  const r = new BincodeReader(bytes);
  const parties = readBincodeBytes32Vec(r);
  if (parties === null) return null;

  let threshold: number | null = null;
  let amount: bigint | null = null;
  let deadline: bigint | null = null;

  const rem = r.remaining();
  // Case 1: threshold u8 (1 byte) + amount u64 (8 bytes) + deadline u64 (8 bytes) = 17 bytes
  if (rem === 17) {
    threshold = r.u8();
    amount = r.u64();
    deadline = r.u64();
  }
  // Case 2: threshold u32 (4 bytes) + amount u64 (8 bytes) + deadline u64 (8 bytes) = 20 bytes
  else if (rem === 20) {
    threshold = r.u32();
    amount = r.u64();
    deadline = r.u64();
  }
  // Case 3: threshold u8 (1 byte) + amount u128 (16 bytes) + deadline u64 (8 bytes) = 25 bytes
  else if (rem === 25) {
    threshold = r.u8();
    amount = r.u128();
    deadline = r.u64();
  }
  // Case 4: threshold u32 (4 bytes) + amount u128 (16 bytes) + deadline u64 (8 bytes) = 28 bytes
  else if (rem === 28) {
    threshold = r.u32();
    amount = r.u128();
    deadline = r.u64();
  } else {
    return null;
  }

  if (threshold === null || amount === null || deadline === null || !r.isEof()) {
    return null;
  }

  return {
    parties: parties.map(bytesToHex),
    partiesAddresses: parties.map((p) => tryFormatAddress(p)).filter((a): a is string => Boolean(a)),
    threshold,
    amount,
    deadline,
  };
}

export function decodeTokenTransferArgs(bytes: Uint8Array): TokenTransferParams | null {
  if (bytes.length !== 48) return null;
  const r = new BincodeReader(bytes);
  const to = r.bytes32();
  const amount = r.u128();
  if (!to || amount === null || !r.isEof()) return null;

  return {
    to: bytesToHex(to),
    toAddress: tryFormatAddress(to),
    amount,
  };
}

export function decodeVaultCreateArgs(bytes: Uint8Array): VaultCreateParams | null {
  // Case 1: Simple 40 bytes: (owner: [u8; 32], lock_until: u64)
  if (bytes.length === 40) {
    const r = new BincodeReader(bytes);
    const owner = r.bytes32();
    const lockUntil = r.u64();
    if (owner && lockUntil !== null && r.isEof()) {
      return {
        owner: bytesToHex(owner),
        ownerAddress: tryFormatAddress(owner),
        lockUntil,
      };
    }
  }

  // Case 2: 60 bytes (beneficiary: [u8; 32], amount: u128, schedule: Absolute { lock_until: u64 })
  if (bytes.length === 60) {
    const r = new BincodeReader(bytes);
    const beneficiary = r.bytes32();
    const amount = r.u128();
    const vestType = r.u32(); // 0 = Absolute
    const lockUntil = r.u64();
    if (beneficiary && amount !== null && vestType === 0 && lockUntil !== null && r.isEof()) {
      return {
        owner: bytesToHex(beneficiary),
        ownerAddress: tryFormatAddress(beneficiary),
        lockUntil,
        amount,
      };
    }
  }

  return null;
}

export function decodeMultisigCreateArgs(bytes: Uint8Array): MultisigCreateParams | null {
  const r = new BincodeReader(bytes);
  const owners = readBincodeBytes32Vec(r);
  if (!owners) return null;
  const threshold = r.u32();
  if (threshold === null || !r.isEof()) return null;

  return {
    owners: owners.map(bytesToHex),
    ownersAddresses: owners.map((p) => tryFormatAddress(p)).filter((a): a is string => Boolean(a)),
    threshold,
  };
}

// --- Main Unified Contract Call Decoder ---

/**
 * Decodes contract call arguments into typed structured payloads.
 * Returns `{ recognized: false, rawHex: string }` if unknown, corrupted, or malformed.
 */
export function decodeContractCall(
  method: string,
  args: Uint8Array | string,
): DecodedContractCall {
  let bytes: Uint8Array | null = null;
  let rawHex = "";

  if (typeof args === "string") {
    const clean = args.trim();
    rawHex = clean.startsWith("0x") || clean.startsWith("0X") ? clean.slice(2).toLowerCase() : clean.toLowerCase();
    bytes = hexToBytes(clean);
  } else if (args instanceof Uint8Array) {
    bytes = args;
    rawHex = bytesToHex(args);
  }

  if (bytes === null) {
    return {
      recognized: false,
      method,
      rawHex,
      error: "Invalid hex payload",
    };
  }

  const normMethod = method.trim().toLowerCase();

  switch (normMethod) {
    case "name_register": {
      const params = decodeNameRegisterArgs(bytes);
      if (params) {
        return { recognized: true, method: "name_register", params, rawHex };
      }
      break;
    }
    case "htlc_create": {
      const params = decodeHtlcCreateArgs(bytes);
      if (params) {
        return { recognized: true, method: "htlc_create", params, rawHex };
      }
      break;
    }
    case "nft_mint": {
      const params = decodeNftMintArgs(bytes);
      if (params) {
        return { recognized: true, method: "nft_mint", params, rawHex };
      }
      break;
    }
    case "escrow_create": {
      const params = decodeEscrowCreateArgs(bytes);
      if (params) {
        return { recognized: true, method: "escrow_create", params, rawHex };
      }
      break;
    }
    case "token_transfer": {
      const params = decodeTokenTransferArgs(bytes);
      if (params) {
        return { recognized: true, method: "token_transfer", params, rawHex };
      }
      break;
    }
    case "vault_create": {
      const params = decodeVaultCreateArgs(bytes);
      if (params) {
        return { recognized: true, method: "vault_create", params, rawHex };
      }
      break;
    }
    case "multisig_create": {
      const params = decodeMultisigCreateArgs(bytes);
      if (params) {
        return { recognized: true, method: "multisig_create", params, rawHex };
      }
      break;
    }
    default:
      return {
        recognized: false,
        method,
        rawHex,
        error: `Unrecognized method '${method}'`,
      };
  }

  return {
    recognized: false,
    method,
    rawHex,
    error: `Corrupted or invalid argument payload for '${method}'`,
  };
}

// --- Transaction Kind Detection ---

export function getTransactionKind(tx: {
  coinbase?: boolean;
  kind?: unknown;
  type?: string;
  method?: string;
  args?: unknown;
}): "Coinbase" | "Call" | "Deploy" | "Transfer" {
  if (tx.coinbase) return "Coinbase";
  const kindVal =
    typeof tx.kind === "string"
      ? tx.kind
      : typeof tx.kind === "object" && tx.kind !== null && "type" in tx.kind && typeof (tx.kind as { type?: unknown }).type === "string"
        ? (tx.kind as { type: string }).type
        : tx.type;

  if (kindVal) {
    if (/call/i.test(kindVal)) return "Call";
    if (/deploy/i.test(kindVal)) return "Deploy";
    if (/transfer/i.test(kindVal)) return "Transfer";
  }
  if (tx.method || (typeof tx.kind === "object" && tx.kind !== null && "method" in tx.kind)) return "Call";
  return "Transfer";
}

export function formatTimestampDisplay(ts: bigint | number): string {
  const num = typeof ts === "bigint" ? Number(ts) : ts;
  // If timestamp is in seconds (e.g. 1_700_000_000), convert to ms
  const ms = num < 100_000_000_000 ? num * 1000 : num;
  try {
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return `${d.toUTCString()} (raw: ${ts.toString()})`;
    }
  } catch {
    // Fallback
  }
  return ts.toString();
}

export function formatAtomsDisplay(atoms: bigint | number | string, decimals = 9): string {
  let b: bigint;
  try {
    if (typeof atoms === "string") {
      const clean = atoms.trim();
      b = clean.startsWith("0x") || clean.startsWith("0X") ? BigInt(clean) : BigInt(clean);
    } else {
      b = BigInt(atoms);
    }
  } catch {
    return String(atoms);
  }

  const base = 10n ** BigInt(decimals);
  const whole = b / base;
  const frac = (b % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

// --- Canonical Encoders Matching kovanica-sdk ---

export function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

export function u32le(val: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, val, true);
  return buf;
}

export function u64le(val: bigint | number): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(val), true);
  return buf;
}

export function u128le(val: bigint | number): Uint8Array {
  const buf = new Uint8Array(16);
  const view = new DataView(buf.buffer);
  const b = BigInt(val);
  view.setBigUint64(0, b & 0xffffffffffffffffn, true);
  view.setBigUint64(8, b >> 64n, true);
  return buf;
}

export function encodeBincodeString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  return concatBytes([u64le(bytes.length), bytes]);
}

export function encodeBincodeBytes32Vec(items: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [u64le(items.length)];
  for (const item of items) {
    if (item.length !== 32) throw new Error(`Expected 32-byte item, got ${item.length}`);
    parts.push(item);
  }
  return concatBytes(parts);
}

export function encodeBincodeStringVec(items: string[]): Uint8Array {
  const parts: Uint8Array[] = [u64le(items.length)];
  for (const s of items) {
    parts.push(encodeBincodeString(s));
  }
  return concatBytes(parts);
}

export function buildNameRegisterCall(
  name: string,
  pubkey: Uint8Array,
  relayEndpoints: string[],
): Uint8Array {
  if (pubkey.length !== 32) throw new Error(`Expected 32-byte pubkey, got ${pubkey.length}`);
  return concatBytes([
    encodeBincodeString(name),
    pubkey,
    encodeBincodeStringVec(relayEndpoints),
  ]);
}

export function buildHtlcCreateCall(
  hashlock: Uint8Array,
  timelock: bigint | number,
  recipient: Uint8Array,
): Uint8Array {
  if (hashlock.length !== 32) throw new Error(`Expected 32-byte hashlock, got ${hashlock.length}`);
  if (recipient.length !== 32) throw new Error(`Expected 32-byte recipient, got ${recipient.length}`);
  return concatBytes([hashlock, u64le(timelock), recipient]);
}

export function buildNftMintCall(
  collection: Uint8Array,
  to: Uint8Array,
  tokenId: bigint | number,
  tokenUri: string,
): Uint8Array {
  if (collection.length !== 32) throw new Error(`Expected 32-byte collection, got ${collection.length}`);
  if (to.length !== 32) throw new Error(`Expected 32-byte to, got ${to.length}`);
  return concatBytes([collection, to, u128le(tokenId), encodeBincodeString(tokenUri)]);
}

export function buildEscrowCreateCall(
  parties: Uint8Array[],
  threshold: number,
  amount: bigint | number,
  deadline: bigint | number,
): Uint8Array {
  return concatBytes([
    encodeBincodeBytes32Vec(parties),
    Uint8Array.of(threshold),
    u64le(amount),
    u64le(deadline),
  ]);
}

export function buildTokenTransferCall(to: Uint8Array, amount: bigint | number): Uint8Array {
  if (to.length !== 32) throw new Error(`Expected 32-byte recipient, got ${to.length}`);
  return concatBytes([to, u128le(amount)]);
}

export function buildVaultCreateCall(
  owner: Uint8Array,
  lockUntil: bigint | number,
  amount?: bigint | number,
): Uint8Array {
  if (owner.length !== 32) throw new Error(`Expected 32-byte owner, got ${owner.length}`);
  if (amount !== undefined) {
    return concatBytes([owner, u128le(amount), u32le(0), u64le(lockUntil)]);
  }
  return concatBytes([owner, u64le(lockUntil)]);
}
