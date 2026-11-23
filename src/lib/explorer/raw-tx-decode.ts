/**
 * Pure, dependency-free offline Bincode 1.x wire transaction decoder
 * supporting both `Transfer` (variant 0) and `Call` (variant 6) transactions.
 *
 * Parses the canonical Kovanica L1 Bincode wire layouts without making any
 * network or RPC calls:
 *
 * `Transfer` (fixed 196 bytes):
 *   sender[32]
 * + nonce (u64le)
 * + variant (u32le == 0 for Transfer)
 * + recipient[32]
 * + amount (u64le)
 * + fee (u64le)
 * + sig_len (u64le == 64)
 * + sig[64]
 * + wireHash[32]
 *
 * `TxKind::Call`:
 *   sender[32]
 * + nonce (u64le)
 * + fee (u128le)
 * + variant (u32le == 6 for Call)
 * + contract[32]
 * + args_len (u64le)
 * + args[args_len]
 * + gas_limit (u64le)
 * + sig_len (u64le == 64)
 * + sig[64]
 */

import {
  BincodeReader,
  bytesToHex,
  decodeEscrowCreateArgs,
  decodeHtlcCreateArgs,
  decodeMultisigCreateArgs,
  decodeNameRegisterArgs,
  decodeNftMintArgs,
  decodeTokenTransferArgs,
  decodeVaultCreateArgs,
  type DecodedContractCall,
} from "../contracts/decoders";
import { encodeAddress } from "../wallet/address";

/** Maximum accepted raw wire transaction size in bytes (256 KiB). */
export const MAX_WIRE_TX_BYTES = 262_144;

/** Bincode 1.x enum discriminant for `Transfer`. */
export const TRANSFER_TX_VARIANT = 0;

/** Fixed canonical wire size in bytes for a signed L1 `Transfer` transaction. */
export const TRANSFER_TX_WIRE_SIZE = 196;

/** Bincode 1.x enum discriminant for `TxKind::Call`. */
export const CALL_TX_VARIANT = 6;

/** Expected Ed25519 signature length in bytes. */
const ED25519_SIG_BYTES = 64;

export type RecognizedDecodedCallArgs = Extract<DecodedContractCall, { recognized: true }>;

export type DecodedWireTransferTx = {
  senderHex: string;
  senderAddress: string;
  nonce: bigint;
  recipientHex: string;
  recipientAddress: string;
  amountAtoms: bigint;
  feeAtoms: bigint;
  signatureHex: string;
  wireHashHex: string;
  wireSizeBytes: number;
};

export type DecodeWireTransferTxResult =
  | { ok: true; tx: DecodedWireTransferTx }
  | { ok: false; error: string };

export type DecodedWireCallTx = {
  senderHex: string;
  senderAddress: string;
  nonce: bigint;
  fee: bigint;
  contractHex: string;
  contractAddress: string;
  argsHex: string;
  argsLength: number;
  gasLimit: bigint;
  signatureHex: string;
  wireSizeBytes: number;
  decodedCallArgs?: RecognizedDecodedCallArgs;
};

export type DecodeWireCallTxResult =
  | { ok: true; tx: DecodedWireCallTx }
  | { ok: false; error: string };

export type DecodeWireTxAutoResult =
  | { ok: true; kind: "transfer"; tx: DecodedWireTransferTx }
  | { ok: true; kind: "call"; tx: DecodedWireCallTx }
  | { ok: false; error: string };

function tryEncodePro21Address(bytes: Uint8Array, fallbackHex: string): string {
  try {
    return encodeAddress(bytes);
  } catch {
    return fallbackHex;
  }
}

function isPrintableAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

/**
 * Best-effort offline recognition of canonical Wasmi contract call argument payloads.
 * Returns `undefined` if the args are empty or do not cleanly match a known layout.
 */
function tryDecodeKnownCallArgs(args: Uint8Array): RecognizedDecodedCallArgs | undefined {
  if (args.length === 0) return undefined;
  const rawHex = bytesToHex(args);

  // 1. Variable-length structured payloads with strict UTF-8 / vector invariants
  const nameReg = decodeNameRegisterArgs(args);
  if (
    nameReg &&
    nameReg.name.length > 0 &&
    nameReg.name.length <= 128 &&
    isPrintableAscii(nameReg.name) &&
    nameReg.relayEndpoints.every((ep) => ep.length > 0 && isPrintableAscii(ep))
  ) {
    return { recognized: true, method: "name_register", params: nameReg, rawHex };
  }

  const nftMint = decodeNftMintArgs(args);
  if (
    nftMint &&
    nftMint.tokenUri.length > 0 &&
    nftMint.tokenUri.length <= 2048 &&
    isPrintableAscii(nftMint.tokenUri)
  ) {
    return { recognized: true, method: "nft_mint", params: nftMint, rawHex };
  }

  const escrow = decodeEscrowCreateArgs(args);
  if (
    escrow &&
    escrow.parties.length > 0 &&
    escrow.threshold > 0 &&
    escrow.threshold <= escrow.parties.length
  ) {
    return { recognized: true, method: "escrow_create", params: escrow, rawHex };
  }

  const multisig = decodeMultisigCreateArgs(args);
  if (
    multisig &&
    multisig.owners.length > 0 &&
    multisig.threshold > 0 &&
    multisig.threshold <= multisig.owners.length
  ) {
    return { recognized: true, method: "multisig_create", params: multisig, rawHex };
  }

  // 2. Fixed-size canonical payloads (40, 48, 60, 72, 88 bytes — mutually disjoint)
  if (args.length === 48) {
    const transfer = decodeTokenTransferArgs(args);
    if (transfer) {
      return { recognized: true, method: "token_transfer", params: transfer, rawHex };
    }
  }

  if (args.length === 40 || args.length === 60) {
    const vault = decodeVaultCreateArgs(args);
    if (vault) {
      return { recognized: true, method: "vault_create", params: vault, rawHex };
    }
  }

  if (args.length === 72 || args.length === 88) {
    const htlc = decodeHtlcCreateArgs(args);
    if (htlc) {
      return { recognized: true, method: "htlc_create", params: htlc, rawHex };
    }
  }

  return undefined;
}

type ParsedHexBytesResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string };

function parseWireTxHex(hexInput: string): ParsedHexBytesResult {
  const trimmed = hexInput.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a hex-encoded Bincode wire transaction." };
  }

  const clean =
    trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;

  if (clean.length === 0) {
    return { ok: false, error: "Hex payload is empty after 0x prefix." };
  }

  if (clean.length % 2 !== 0) {
    return {
      ok: false,
      error: `Invalid hex length: expected an even number of hex characters, got ${clean.length}.`,
    };
  }

  const byteLength = clean.length / 2;
  if (byteLength > MAX_WIRE_TX_BYTES) {
    return {
      ok: false,
      error: `Wire transaction exceeds maximum allowed size of ${MAX_WIRE_TX_BYTES.toLocaleString()} bytes (got ${byteLength.toLocaleString()} bytes).`,
    };
  }

  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    return { ok: false, error: "Input contains non-hexadecimal characters." };
  }

  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }

  return { ok: true, bytes };
}

function readU32LeAt(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getUint32(0, true);
}

function decodeWireTransferTxBytes(bytes: Uint8Array): DecodeWireTransferTxResult {
  const reader = new BincodeReader(bytes);

  const senderBytes = reader.bytes32();
  if (!senderBytes) {
    return {
      ok: false,
      error: "Truncated Transfer wire transaction: missing 32-byte sender public key.",
    };
  }

  const nonce = reader.u64();
  if (nonce === null) {
    return {
      ok: false,
      error: "Truncated Transfer wire transaction: missing 8-byte nonce (u64).",
    };
  }

  const variant = reader.u32();
  if (variant === null) {
    return {
      ok: false,
      error:
        "Truncated Transfer wire transaction: missing 4-byte transaction variant discriminant (u32).",
    };
  }

  if (variant !== TRANSFER_TX_VARIANT) {
    return {
      ok: false,
      error: `Unsupported transaction variant discriminant ${variant}: only Transfer transactions (variant ${TRANSFER_TX_VARIANT}) are supported.`,
    };
  }

  const recipientBytes = reader.bytes32();
  if (!recipientBytes) {
    return {
      ok: false,
      error: "Truncated Transfer payload: missing 32-byte recipient public key.",
    };
  }

  const amountAtoms = reader.u64();
  if (amountAtoms === null) {
    return {
      ok: false,
      error: "Truncated Transfer payload: missing 8-byte amount (u64).",
    };
  }

  const feeAtoms = reader.u64();
  if (feeAtoms === null) {
    return {
      ok: false,
      error: "Truncated Transfer payload: missing 8-byte fee (u64).",
    };
  }

  const sigLen = reader.u64();
  if (sigLen === null) {
    return {
      ok: false,
      error: "Truncated Transfer wire transaction: missing 8-byte signature length prefix (u64).",
    };
  }

  if (sigLen !== BigInt(ED25519_SIG_BYTES)) {
    return {
      ok: false,
      error: `Invalid signature length: expected ${ED25519_SIG_BYTES} bytes (Ed25519), got ${sigLen.toString()}.`,
    };
  }

  const sigBytes = reader.bytes(ED25519_SIG_BYTES);
  if (!sigBytes) {
    return {
      ok: false,
      error: "Truncated Transfer wire transaction: missing 64-byte Ed25519 signature.",
    };
  }

  const wireHashBytes = reader.bytes32();
  if (!wireHashBytes) {
    return {
      ok: false,
      error: `Truncated Transfer wire transaction: missing 32-byte wire hash (expected ${TRANSFER_TX_WIRE_SIZE} bytes total).`,
    };
  }

  if (!reader.isEof()) {
    return {
      ok: false,
      error: `Invalid Transfer wire transaction: ${reader.remaining()} unexpected trailing byte(s) after wire hash (expected ${TRANSFER_TX_WIRE_SIZE} bytes total).`,
    };
  }

  const senderHex = bytesToHex(senderBytes);
  const recipientHex = bytesToHex(recipientBytes);
  const signatureHex = bytesToHex(sigBytes);
  const wireHashHex = bytesToHex(wireHashBytes);

  return {
    ok: true,
    tx: {
      senderHex,
      senderAddress: tryEncodePro21Address(senderBytes, senderHex),
      nonce,
      recipientHex,
      recipientAddress: tryEncodePro21Address(recipientBytes, recipientHex),
      amountAtoms,
      feeAtoms,
      signatureHex,
      wireHashHex,
      wireSizeBytes: bytes.length,
    },
  };
}

function decodeWireCallTxBytes(bytes: Uint8Array): DecodeWireCallTxResult {
  const reader = new BincodeReader(bytes);

  const senderBytes = reader.bytes32();
  if (!senderBytes) {
    return {
      ok: false,
      error: "Truncated wire transaction: missing 32-byte sender public key.",
    };
  }

  const nonce = reader.u64();
  if (nonce === null) {
    return { ok: false, error: "Truncated wire transaction: missing 8-byte nonce (u64)." };
  }

  const fee = reader.u128();
  if (fee === null) {
    return { ok: false, error: "Truncated wire transaction: missing 16-byte fee (u128)." };
  }

  const variant = reader.u32();
  if (variant === null) {
    return {
      ok: false,
      error: "Truncated wire transaction: missing 4-byte transaction variant discriminant (u32).",
    };
  }

  if (variant !== CALL_TX_VARIANT) {
    return {
      ok: false,
      error: `Unsupported transaction variant discriminant ${variant}: only Call transactions (variant ${CALL_TX_VARIANT}) are supported.`,
    };
  }

  const contractBytes = reader.bytes32();
  if (!contractBytes) {
    return {
      ok: false,
      error: "Truncated Call payload: missing 32-byte contract address.",
    };
  }

  const argsLen = reader.u64();
  if (argsLen === null) {
    return {
      ok: false,
      error: "Truncated Call payload: missing 8-byte args length prefix (u64).",
    };
  }

  if (argsLen > BigInt(reader.remaining())) {
    return {
      ok: false,
      error: `Truncated Call payload: args length (${argsLen.toString()} bytes) exceeds remaining buffer (${reader.remaining()} bytes).`,
    };
  }

  const argsLength = Number(argsLen);
  const argsBytes = reader.bytes(argsLength);
  if (!argsBytes) {
    return { ok: false, error: "Truncated Call payload: unable to read args bytes." };
  }

  const gasLimit = reader.u64();
  if (gasLimit === null) {
    return {
      ok: false,
      error: "Truncated Call payload: missing 8-byte gas_limit (u64).",
    };
  }

  const sigLen = reader.u64();
  if (sigLen === null) {
    return {
      ok: false,
      error: "Truncated wire transaction: missing 8-byte signature length prefix (u64).",
    };
  }

  if (sigLen !== BigInt(ED25519_SIG_BYTES)) {
    return {
      ok: false,
      error: `Invalid signature length: expected ${ED25519_SIG_BYTES} bytes (Ed25519), got ${sigLen.toString()}.`,
    };
  }

  const sigBytes = reader.bytes(ED25519_SIG_BYTES);
  if (!sigBytes) {
    return {
      ok: false,
      error: "Truncated wire transaction: missing 64-byte Ed25519 signature.",
    };
  }

  if (!reader.isEof()) {
    return {
      ok: false,
      error: `Invalid wire transaction: ${reader.remaining()} unexpected trailing byte(s) after signature.`,
    };
  }

  const senderHex = bytesToHex(senderBytes);
  const contractHex = bytesToHex(contractBytes);
  const argsHex = bytesToHex(argsBytes);
  const signatureHex = bytesToHex(sigBytes);
  const decodedCallArgs = tryDecodeKnownCallArgs(argsBytes);

  return {
    ok: true,
    tx: {
      senderHex,
      senderAddress: tryEncodePro21Address(senderBytes, senderHex),
      nonce,
      fee,
      contractHex,
      contractAddress: tryEncodePro21Address(contractBytes, contractHex),
      argsHex,
      argsLength,
      gasLimit,
      signatureHex,
      wireSizeBytes: bytes.length,
      ...(decodedCallArgs ? { decodedCallArgs } : {}),
    },
  };
}

/**
 * Decodes a hex-encoded (bare or `0x`-prefixed) Bincode 1.x wire `Transfer` transaction offline.
 */
export function decodeWireTransferTxHex(hexInput: string): DecodeWireTransferTxResult {
  const parsed = parseWireTxHex(hexInput);
  if (!parsed.ok) return parsed;
  return decodeWireTransferTxBytes(parsed.bytes);
}

/**
 * Decodes a hex-encoded (bare or `0x`-prefixed) Bincode 1.x wire `Call` transaction offline.
 */
export function decodeWireCallTxHex(hexInput: string): DecodeWireCallTxResult {
  const parsed = parseWireTxHex(hexInput);
  if (!parsed.ok) return parsed;
  return decodeWireCallTxBytes(parsed.bytes);
}

/**
 * Auto-detects and decodes a hex-encoded Bincode 1.x wire `Transfer` or `Call`
 * transaction offline by peeking the variant discriminant at offset 40 (Transfer)
 * and offset 56 (Call).
 */
export function decodeWireTxAutoHex(hexInput: string): DecodeWireTxAutoResult {
  const parsed = parseWireTxHex(hexInput);
  if (!parsed.ok) return parsed;

  const { bytes } = parsed;
  const variantAt40 = readU32LeAt(bytes, 40);
  if (variantAt40 === null) {
    return {
      ok: false,
      error:
        "Truncated wire transaction: expected at least 44 bytes to read sender, nonce, and variant discriminant.",
    };
  }

  const variantAt56 = readU32LeAt(bytes, 56);

  if (variantAt40 === TRANSFER_TX_VARIANT) {
    const transferRes = decodeWireTransferTxBytes(bytes);
    if (transferRes.ok) {
      return { ok: true, kind: "transfer", tx: transferRes.tx };
    }
    if (variantAt56 === CALL_TX_VARIANT) {
      const callRes = decodeWireCallTxBytes(bytes);
      if (callRes.ok) {
        return { ok: true, kind: "call", tx: callRes.tx };
      }
    }
    return transferRes;
  }

  if (variantAt56 === null) {
    return {
      ok: false,
      error:
        "Truncated wire transaction: missing Call variant discriminant at offset 56 (and offset 40 is not Transfer variant 0).",
    };
  }

  if (variantAt56 === CALL_TX_VARIANT) {
    const callRes = decodeWireCallTxBytes(bytes);
    if (callRes.ok) {
      return { ok: true, kind: "call", tx: callRes.tx };
    }
    return callRes;
  }

  return {
    ok: false,
    error: `Unsupported transaction variant discriminant: expected Transfer (variant ${TRANSFER_TX_VARIANT}) or Call (variant ${CALL_TX_VARIANT}), got ${variantAt40} at offset 40 / ${variantAt56} at offset 56.`,
  };
}
