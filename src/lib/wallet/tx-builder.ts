/**
 * Canonical client-side transaction builder, bincode encoder, and signer for
 * KVP-102 Tokens, KVP-106 NFTs, and KVP-106 Real-World Assets (RWAs).
 *
 * Byte-for-byte compatible with:
 * - `kovanica-l1/crates/kovanica-types/src/transaction.rs`
 * - `kovanica-l1/crates/kovanica-execution/src/call_args.rs`
 * - `kovanica-l1/crates/kovanica-cli/src/contracts.rs`
 * - `kovanica-sdk/src/contracts.ts`
 * - `kovanica-apps/android-wallet/.../CreateTokenActivity.kt`
 */
import { blake3 } from "@noble/hashes/blake3.js";
import { api, apiPostJson } from "@/lib/api/client";
import { CHAIN_ID, FIXED_FEES, MIN_FEE } from "@/lib/networkConstants";
import { encodeAddress, hexToKvnc, parseAddr } from "@/lib/wallet/address";
import { signSighash } from "@/lib/wallet/keys";
import type { WalletRec } from "@/lib/ledger/types";

export const DEFAULT_CONTRACT_GAS_LIMIT = 10_000_000n;
const CALL_WIRE_OVERHEAD = 152;
const DEPLOY_WIRE_OVERHEAD = 152;

const TX_DOMAIN = asciiPad("KVNC/tx/v1", 16);
const TX_KEY = asciiPad("KVNC-TX-v1", 32);

export const WATCHED_TOKENS_KEY = "kovanica.watched_tokens";

export interface KovanicaExtensionProvider {
  readonly isKovanica?: boolean;
  connect(): Promise<{ accounts: string[]; chainId: number }>;
  getAccounts(): Promise<string[]>;
  getChainId?(): Promise<number>;
  signTransaction(tx: {
    kind: "call";
    contract: string;
    method: string;
    argsHex?: string;
    value?: string | number;
    gasLimit?: string | number;
    nonce: string | number;
    fee?: string | number;
    chainId?: number;
  }): Promise<{
    rawTxHex: string;
    signingHashHex: string;
    signatureHex: string;
  }>;
  signBatchTransaction?(tx: {
    actions: Array<{
      kind: "transfer" | "deploy" | "call";
      to?: string;
      amount?: string | number;
      codeHex?: string;
      contract?: string;
      value?: string | number;
      method?: string;
      argsHex?: string;
      gasLimit?: string | number;
    }>;
    nonce: string | number;
    fee?: string | number;
    chainId?: number;
  }): Promise<{
    rawTxHex: string;
    signingHashHex: string;
    signatureHex: string;
    actionCount: number;
  }>;
}

export function getKovanicaExtension(): KovanicaExtensionProvider | null {
  if (typeof window === "undefined") return null;
  const ext = (window as unknown as { kovanica?: KovanicaExtensionProvider }).kovanica;
  return ext && typeof ext.signTransaction === "function" ? ext : null;
}

// --- Byte / bincode primitives ------------------------------------------------

function asciiPad(str: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const bytes = new TextEncoder().encode(str);
  out.set(bytes.subarray(0, size));
  return out;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("Invalid hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function u32le(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`Value out of range for u32: ${value}`);
  }
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, true);
  return buf;
}

export function u64le(value: bigint | number): Uint8Array {
  const b = BigInt(value);
  if (b < 0n || b > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError(`Value out of range for u64: ${value}`);
  }
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, b, true);
  return buf;
}

export function u128le(value: bigint | number): Uint8Array {
  const b = BigInt(value);
  if (b < 0n || b > (1n << 128n) - 1n) {
    throw new RangeError(`Value out of range for u128: ${value}`);
  }
  const buf = new Uint8Array(16);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, b & 0xffff_ffff_ffff_ffffn, true);
  view.setBigUint64(8, b >> 64n, true);
  return buf;
}

export function encodeBincodeString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  return concatBytes([u64le(bytes.length), bytes]);
}

function addressBytes32(addr: string, label: string): Uint8Array {
  const hex = parseAddr(addr);
  if (!hex) throw new Error(`Invalid ${label}: expected kvnc…dag or 64-hex address`);
  return hexToBytes(hex);
}

// --- Deterministic Address & Asset ID Derivation ------------------------------

/**
 * Contract address the node derives for a `Deploy` signed with `deployNonce`.
 *
 * Matches `kovanica-cli/src/contracts.rs::deployed_contract_address`:
 * `blake3(sender_32 || u64le(deployNonce + 1))`.
 */
export function deriveDeployedContractAddress(
  sender: string,
  deployNonce: bigint | number,
): string {
  const senderBytes = addressBytes32(sender, "sender address");
  const postNonce = BigInt(deployNonce) + 1n;
  const seed = concatBytes([senderBytes, u64le(postNonce)]);
  return bytesToHex(blake3(seed));
}

/**
 * Deterministic KVP-106 RWA `asset_id` derivation matching `kovanica_rwa::derive_asset_id`.
 * `blake3("kvp106:rwa:v1" || issuer_32 || 0x00 || assetClass || 0x00 || uniqueId || u32le(version))`.
 */
export function deriveRwaAssetId(
  issuer: string,
  assetClass: string,
  uniqueId: string,
  version: number,
): { assetIdHex: string; assetIdKvnc: string } {
  const enc = new TextEncoder();
  const issuerBytes = addressBytes32(issuer, "issuer address");
  const preimage = concatBytes([
    enc.encode("kvp106:rwa:v1"),
    issuerBytes,
    Uint8Array.of(0),
    enc.encode(assetClass),
    Uint8Array.of(0),
    enc.encode(uniqueId),
    u32le(version),
  ]);
  const digest = blake3(preimage);
  return {
    assetIdHex: bytesToHex(digest),
    assetIdKvnc: encodeAddress(digest),
  };
}

// --- Contract Calldata Bincode Encoders ---------------------------------------

/**
 * `token_create(name, symbol, decimals, initial_supply, icon)`.
 * Wire layout: `(String, String, u8, u128, String)`.
 */
export function encodeTokenCreateArgs(params: {
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: bigint;
  icon?: string;
}): Uint8Array {
  if (!Number.isInteger(params.decimals) || params.decimals < 0 || params.decimals > 18) {
    throw new Error("Decimals must be an integer between 0 and 18");
  }
  return concatBytes([
    encodeBincodeString(params.name),
    encodeBincodeString(params.symbol),
    Uint8Array.of(params.decimals & 0xff),
    u128le(params.initialSupply),
    encodeBincodeString(params.icon ?? ""),
  ]);
}

/**
 * `nft_create_collection(name, symbol, base_uri)`.
 * Wire layout: `(String, String, String)`.
 */
export function encodeNftCreateCollectionArgs(params: {
  name: string;
  symbol: string;
  baseUri: string;
}): Uint8Array {
  return concatBytes([
    encodeBincodeString(params.name),
    encodeBincodeString(params.symbol),
    encodeBincodeString(params.baseUri),
  ]);
}

/**
 * `nft_mint(collection, to, token_id, token_uri)`.
 * Wire layout: `([u8; 32], [u8; 32], u128, String)`.
 */
export function encodeNftMintArgs(params: {
  collection: string;
  to: string;
  tokenId: bigint | number;
  tokenUri: string;
}): Uint8Array {
  const collectionBytes = addressBytes32(params.collection, "collection address");
  const toBytes = addressBytes32(params.to, "recipient address");
  return concatBytes([
    collectionBytes,
    toBytes,
    u128le(params.tokenId),
    encodeBincodeString(params.tokenUri),
  ]);
}

/**
 * `rwa_create(name, symbol, asset_class, unique_id, version, jurisdiction,
 *  metadata_hash, metadata_uri, legal_uri, custody_uri, decimals, max_supply, initial_supply)`.
 */
export function encodeRwaCreateArgs(params: {
  name: string;
  symbol: string;
  assetClass: string;
  uniqueId: string;
  version: number;
  jurisdiction: string;
  metadataHashHex: string;
  metadataUri: string;
  legalUri: string;
  custodyUri: string;
  decimals: number;
  maxSupply: bigint;
  initialSupply: bigint;
}): Uint8Array {
  const metaHash = hexToBytes(params.metadataHashHex);
  if (metaHash.length !== 32) {
    throw new Error("metadataHashHex must be 32 bytes (64 hex chars)");
  }
  if (!Number.isInteger(params.decimals) || params.decimals < 0 || params.decimals > 18) {
    throw new Error("Decimals must be between 0 and 18");
  }
  return concatBytes([
    encodeBincodeString(params.name),
    encodeBincodeString(params.symbol),
    encodeBincodeString(params.assetClass),
    encodeBincodeString(params.uniqueId),
    u32le(params.version),
    encodeBincodeString(params.jurisdiction),
    metaHash,
    encodeBincodeString(params.metadataUri),
    encodeBincodeString(params.legalUri),
    encodeBincodeString(params.custodyUri),
    Uint8Array.of(params.decimals & 0xff),
    u128le(params.maxSupply),
    u128le(params.initialSupply),
  ]);
}

/**
 * `rwa_mint(to, amount)` / `rwa_transfer(to, amount)`.
 * Wire layout: `([u8; 32], u128)`.
 */
export function encodeRwaToAmountArgs(to: string, amount: bigint): Uint8Array {
  return concatBytes([addressBytes32(to, "recipient address"), u128le(amount)]);
}

// --- Transaction Signing Preimage & Wire Bincode Serialization ----------------

function signingHashForKind(
  sender: Uint8Array,
  nonce: bigint,
  signingKindBytes: Uint8Array,
  fee: bigint,
  chainId: number,
): Uint8Array {
  const preimage = concatBytes([
    TX_DOMAIN,
    u64le(chainId),
    sender,
    u64le(nonce),
    signingKindBytes,
    u64le(fee),
  ]);
  return blake3(preimage, { key: TX_KEY });
}

function wireEncodeTx(
  sender: Uint8Array,
  nonce: bigint,
  wireKindBytes: Uint8Array,
  fee: bigint,
  signature: Uint8Array,
  sighash: Uint8Array,
): string {
  if (signature.length !== 64) {
    throw new Error(`Expected 64-byte Ed25519 signature, got ${signature.length}`);
  }
  const body = concatBytes([
    sender,
    u64le(nonce),
    wireKindBytes,
    u64le(fee),
    u64le(64n),
    signature,
    sighash,
  ]);
  return bytesToHex(body);
}

/** Signing preimage hash for `TransactionKind::Deploy { code }`. */
export function buildDeploySighash(params: {
  sender: string;
  nonce: bigint | number;
  code: Uint8Array;
  fee: bigint | number;
  chainId?: number;
}): Uint8Array {
  const sender = addressBytes32(params.sender, "sender address");
  // Signing tag for Deploy is u8(3)
  const kindBytes = concatBytes([Uint8Array.of(3), u64le(params.code.length), params.code]);
  return signingHashForKind(
    sender,
    BigInt(params.nonce),
    kindBytes,
    BigInt(params.fee),
    params.chainId ?? CHAIN_ID,
  );
}

/** Wire bincode hex for a signed `TransactionKind::Deploy { code }`. */
export function encodeSignedDeployTx(params: {
  sender: string;
  nonce: bigint | number;
  code: Uint8Array;
  fee: bigint | number;
  signatureHex: string;
  sighash: Uint8Array;
}): string {
  const sender = addressBytes32(params.sender, "sender address");
  // Bincode enum variant index for TransactionKind::Deploy is u32le(5)
  const wireKind = concatBytes([u32le(5), u64le(params.code.length), params.code]);
  return wireEncodeTx(
    sender,
    BigInt(params.nonce),
    wireKind,
    BigInt(params.fee),
    hexToBytes(params.signatureHex),
    params.sighash,
  );
}

/** Signing preimage hash for `TransactionKind::Call { contract, value, method, args, gas_limit }`. */
export function buildCallSighash(params: {
  sender: string;
  nonce: bigint | number;
  contract: string;
  value?: bigint | number;
  method: string;
  args: Uint8Array;
  gasLimit?: bigint | number;
  fee: bigint | number;
  chainId?: number;
}): Uint8Array {
  const sender = addressBytes32(params.sender, "sender address");
  const contract = addressBytes32(params.contract, "contract address");
  const methodBytes = new TextEncoder().encode(params.method);
  // Signing tag for Call is u8(4)
  const kindBytes = concatBytes([
    Uint8Array.of(4),
    contract,
    u64le(params.value ?? 0n),
    u64le(methodBytes.length),
    methodBytes,
    u64le(params.args.length),
    params.args,
    u64le(params.gasLimit ?? DEFAULT_CONTRACT_GAS_LIMIT),
  ]);
  return signingHashForKind(
    sender,
    BigInt(params.nonce),
    kindBytes,
    BigInt(params.fee),
    params.chainId ?? CHAIN_ID,
  );
}

/** Wire bincode hex for a signed `TransactionKind::Call { ... }`. */
export function encodeSignedCallTx(params: {
  sender: string;
  nonce: bigint | number;
  contract: string;
  value?: bigint | number;
  method: string;
  args: Uint8Array;
  gasLimit?: bigint | number;
  fee: bigint | number;
  signatureHex: string;
  sighash: Uint8Array;
}): string {
  const sender = addressBytes32(params.sender, "sender address");
  const contract = addressBytes32(params.contract, "contract address");
  const methodBytes = new TextEncoder().encode(params.method);
  // Bincode enum variant index for TransactionKind::Call is u32le(6)
  const wireKind = concatBytes([
    u32le(6),
    contract,
    u64le(params.value ?? 0n),
    u64le(methodBytes.length),
    methodBytes,
    u64le(params.args.length),
    params.args,
    u64le(params.gasLimit ?? DEFAULT_CONTRACT_GAS_LIMIT),
  ]);
  return wireEncodeTx(
    sender,
    BigInt(params.nonce),
    wireKind,
    BigInt(params.fee),
    hexToBytes(params.signatureHex),
    params.sighash,
  );
}

// --- Network Context, Fee Calculation & Broadcast Helpers ---------------------

export interface AccountTxContext {
  address: string;
  nonce: bigint;
  balance: bigint;
  feeRate: bigint;
  chainId: number;
  fixedFeesActive: boolean;
}

function parseQuantityBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return BigInt(trimmed);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * Fetch live account nonce, balance, fee rate, chain ID, and fixed-fee activation
 * from `/api/account_nonce` + `/api/fee_schedule`.
 */
export async function fetchAccountTxContext(address: string): Promise<AccountTxContext> {
  const hex = parseAddr(address);
  if (!hex) throw new Error("Invalid wallet address");

  const [acct, schedule] = await Promise.all([
    api<{
      address: string;
      nonce: string | number;
      balance: string | number;
      fee_rate: string | number;
      chain_id?: number;
    }>(`/api/account_nonce?address=${encodeURIComponent(hex)}`),
    api<{ active?: boolean; chain_id?: string | number }>("/api/fee_schedule").catch(() => null),
  ]);

  const scheduleChainId =
    schedule?.chain_id !== undefined ? Number(parseQuantityBigInt(schedule.chain_id, BigInt(CHAIN_ID))) : CHAIN_ID;

  return {
    address: hex,
    nonce: parseQuantityBigInt(acct.nonce, 0n),
    balance: parseQuantityBigInt(acct.balance, 0n),
    feeRate: parseQuantityBigInt(acct.fee_rate, BigInt(MIN_FEE)),
    chainId: typeof acct.chain_id === "number" ? acct.chain_id : scheduleChainId,
    fixedFeesActive: Boolean(schedule?.active),
  };
}

/**
 * Compute required fee in atoms for an operation:
 * - Always covers `max(MIN_FEE, feeRate * txBytes)` (with 20% headroom on byte fee).
 * - When `fixedFeesActive` is true on-chain, enforces the Balanced-tier `FIXED_FEES[op]` floor.
 */
export function computeOperationFee(
  op: keyof typeof FIXED_FEES,
  txBytes: number,
  feeRate: bigint,
  fixedFeesActive: boolean,
): bigint {
  const effectiveRate = feeRate > 0n ? feeRate : 1n;
  const byteFee = (BigInt(txBytes) * effectiveRate * 12n) / 10n;
  const minFloor = BigInt(MIN_FEE);
  const dynamicFee = byteFee > minFloor ? byteFee : minFloor;
  if (fixedFeesActive) {
    const fixedFloor = BigInt(FIXED_FEES[op]);
    return fixedFloor > dynamicFee ? fixedFloor : dynamicFee;
  }
  return dynamicFee;
}

/** Broadcast a signed raw transaction hex via `/api/submit_tx` (`kovanica_sendRawTransaction`). */
export async function broadcastRawTx(rawTxHex: string): Promise<string> {
  const res = await apiPostJson<{ ok: boolean; tx: string }>("/api/submit_tx", {
    tx_hex: rawTxHex,
  });
  if (!res?.tx) throw new Error("Node accepted transaction but returned no hash");
  return res.tx;
}

/** Poll `/api/contract_code` until deployed bytecode appears on chain. */
export async function waitForContractDeployed(
  contractHex: string,
  options?: {
    maxAttempts?: number;
    intervalMs?: number;
    onProgress?: (attempt: number, maxAttempts: number) => void;
  },
): Promise<boolean> {
  const maxAttempts = options?.maxAttempts ?? 30;
  const intervalMs = options?.intervalMs ?? 2_500;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    options?.onProgress?.(attempt, maxAttempts);
    try {
      const res = await api<{ deployed: boolean; code_bytes: number }>(
        `/api/contract_code?contract=${encodeURIComponent(contractHex)}`,
      );
      if (res.deployed && res.code_bytes > 0) return true;
    } catch {
      // transient poll error — keep waiting until timeout
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return false;
}

/** Fetch a bundled WASM contract artifact from `/contracts/<filename>`. */
export async function loadContractWasm(filename: "kovanica-token.wasm" | "kovanica-rwa.wasm"): Promise<Uint8Array> {
  const res = await fetch(`/contracts/${filename}`);
  if (!res.ok) {
    throw new Error(`Failed to load contract artifact /contracts/${filename} (HTTP ${res.status})`);
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error(`Invalid WASM bytecode loaded from /contracts/${filename}`);
  }
  return bytes;
}

// --- Unified Signer (Unlocked Web Wallet OR window.kovanica Extension) --------

export type ActiveSigner =
  | {
      kind: "web-wallet";
      addressHex: string;
      addressKvnc: string;
      mnemonic: string;
      index: number;
    }
  | {
      kind: "extension";
      addressHex: string;
      addressKvnc: string;
      provider: KovanicaExtensionProvider;
    };

/** Resolve an unlocked web wallet signer if available. */
export function webWalletSigner(wallet: WalletRec | null): ActiveSigner | null {
  if (!wallet || wallet.type === "hardware" || wallet.kind === "watch" || !wallet.mnemonic) {
    return null;
  }
  const hex = parseAddr(wallet.address);
  if (!hex) return null;
  return {
    kind: "web-wallet",
    addressHex: hex,
    addressKvnc: hexToKvnc(hex),
    mnemonic: wallet.mnemonic,
    index: wallet.index,
  };
}

/** Connect to `window.kovanica` browser extension and return an ActiveSigner. */
export async function connectExtensionSigner(): Promise<ActiveSigner> {
  const provider = getKovanicaExtension();
  if (!provider) {
    throw new Error("window.kovanica extension not detected. Install the Kovanica Browser Extension or unlock your Web Wallet.");
  }
  const { accounts } = await provider.connect();
  const first = accounts?.[0];
  const hex = first ? parseAddr(first) : null;
  if (!hex) {
    throw new Error("Kovanica extension returned no accounts");
  }
  return {
    kind: "extension",
    addressHex: hex,
    addressKvnc: hexToKvnc(hex),
    provider,
  };
}

/** Sign a Deploy transaction using the active signer. */
export async function signDeployTx(
  signer: ActiveSigner,
  params: { nonce: bigint; code: Uint8Array; fee: bigint; chainId: number },
): Promise<{ rawTxHex: string; sighashHex: string }> {
  if (signer.kind === "web-wallet") {
    const sighash = buildDeploySighash({
      sender: signer.addressHex,
      nonce: params.nonce,
      code: params.code,
      fee: params.fee,
      chainId: params.chainId,
    });
    const sighashHex = bytesToHex(sighash);
    const sigHex = await signSighash(signer.mnemonic, signer.index, sighashHex);
    const rawTxHex = encodeSignedDeployTx({
      sender: signer.addressHex,
      nonce: params.nonce,
      code: params.code,
      fee: params.fee,
      signatureHex: sigHex,
      sighash,
    });
    return { rawTxHex, sighashHex };
  }

  // Extension path: use signBatchTransaction with a single deploy action when available.
  if (signer.provider.signBatchTransaction) {
    const signed = await signer.provider.signBatchTransaction({
      actions: [{ kind: "deploy", codeHex: bytesToHex(params.code) }],
      nonce: params.nonce.toString(),
      fee: params.fee.toString(),
      chainId: params.chainId,
    });
    return { rawTxHex: signed.rawTxHex, sighashHex: signed.signingHashHex };
  }
  throw new Error(
    "Your browser extension version does not support contract deploys yet. Unlock your Web Wallet on /wallet to deploy.",
  );
}

/** Sign a Call transaction using the active signer. */
export async function signCallTx(
  signer: ActiveSigner,
  params: {
    nonce: bigint;
    contractHex: string;
    value?: bigint;
    method: string;
    args: Uint8Array;
    gasLimit?: bigint;
    fee: bigint;
    chainId: number;
  },
): Promise<{ rawTxHex: string; sighashHex: string }> {
  const gasLimit = params.gasLimit ?? DEFAULT_CONTRACT_GAS_LIMIT;
  if (signer.kind === "web-wallet") {
    const sighash = buildCallSighash({
      sender: signer.addressHex,
      nonce: params.nonce,
      contract: params.contractHex,
      value: params.value ?? 0n,
      method: params.method,
      args: params.args,
      gasLimit,
      fee: params.fee,
      chainId: params.chainId,
    });
    const sighashHex = bytesToHex(sighash);
    const sigHex = await signSighash(signer.mnemonic, signer.index, sighashHex);
    const rawTxHex = encodeSignedCallTx({
      sender: signer.addressHex,
      nonce: params.nonce,
      contract: params.contractHex,
      value: params.value ?? 0n,
      method: params.method,
      args: params.args,
      gasLimit,
      fee: params.fee,
      signatureHex: sigHex,
      sighash,
    });
    return { rawTxHex, sighashHex };
  }

  const signed = await signer.provider.signTransaction({
    kind: "call",
    contract: hexToKvnc(params.contractHex),
    method: params.method,
    argsHex: bytesToHex(params.args),
    value: (params.value ?? 0n).toString(),
    gasLimit: gasLimit.toString(),
    nonce: params.nonce.toString(),
    fee: params.fee.toString(),
    chainId: params.chainId,
  });
  return { rawTxHex: signed.rawTxHex, sighashHex: signed.signingHashHex };
}

// --- End-to-End Orchestrators -------------------------------------------------

export interface CreateTokenResult {
  contractHex: string;
  contractKvnc: string;
  deployTxHash: string;
  createTxHash: string;
  deployFee: bigint;
  createFee: bigint;
}

/**
 * End-to-end KVP-102 token creation:
 * 1. Load bundled `kovanica-token.wasm`
 * 2. Sign & broadcast `Deploy`
 * 3. Poll `kovanica_getCode` until bytecode lands
 * 4. Sign & broadcast `token_create` `Call` at `nonce + 1`
 */
export async function deployAndCreateToken(
  signer: ActiveSigner,
  params: {
    name: string;
    symbol: string;
    decimals: number;
    initialSupplyAtoms: bigint;
    icon?: string;
    onStatus?: (msg: string) => void;
  },
): Promise<CreateTokenResult> {
  params.onStatus?.("Fetching account nonce and fee schedule…");
  const [ctx, wasmBytes] = await Promise.all([
    fetchAccountTxContext(signer.addressHex),
    loadContractWasm("kovanica-token.wasm"),
  ]);

  const args = encodeTokenCreateArgs({
    name: params.name,
    symbol: params.symbol,
    decimals: params.decimals,
    initialSupply: params.initialSupplyAtoms,
    icon: params.icon ?? "",
  });

  const deployTxBytes = DEPLOY_WIRE_OVERHEAD + 4 + 8 + wasmBytes.length;
  const callTxBytes =
    CALL_WIRE_OVERHEAD + 4 + 32 + 8 + 8 + "token_create".length + 8 + args.length + 8;

  const deployFee = computeOperationFee("deploy", deployTxBytes, ctx.feeRate, ctx.fixedFeesActive);
  const createFee = computeOperationFee("token_create", callTxBytes, ctx.feeRate, ctx.fixedFeesActive);

  if (ctx.balance < deployFee + createFee) {
    throw new Error(
      `Insufficient KVNC balance: have ${(Number(ctx.balance) / 1e9).toFixed(4)} KVNC, need at least ${(Number(deployFee + createFee) / 1e9).toFixed(4)} KVNC for deploy + create fees.`,
    );
  }

  const contractHex = deriveDeployedContractAddress(signer.addressHex, ctx.nonce);
  const contractKvnc = hexToKvnc(contractHex);

  params.onStatus?.("Signing contract Deploy transaction (1/2)…");
  const deploySigned = await signDeployTx(signer, {
    nonce: ctx.nonce,
    code: wasmBytes,
    fee: deployFee,
    chainId: ctx.chainId,
  });

  params.onStatus?.("Broadcasting contract Deploy to Testnet…");
  const deployTxHash = await broadcastRawTx(deploySigned.rawTxHex);

  params.onStatus?.(`Deploy sent (${deployTxHash.slice(0, 12)}…). Waiting for block inclusion…`);
  const deployed = await waitForContractDeployed(contractHex, {
    onProgress: (attempt, max) =>
      params.onStatus?.(`Waiting for Deploy to be mined… (${attempt}/${max})`),
  });
  if (!deployed) {
    throw new Error(
      `Deploy transaction (${deployTxHash.slice(0, 16)}…) was not mined in time. Contract address will be ${contractKvnc}.`,
    );
  }

  params.onStatus?.("Deploy mined! Signing token_create call (2/2)…");
  const createSigned = await signCallTx(signer, {
    nonce: ctx.nonce + 1n,
    contractHex,
    method: "token_create",
    args,
    gasLimit: DEFAULT_CONTRACT_GAS_LIMIT,
    fee: createFee,
    chainId: ctx.chainId,
  });

  params.onStatus?.("Broadcasting token_create call to Testnet…");
  const createTxHash = await broadcastRawTx(createSigned.rawTxHex);

  return {
    contractHex,
    contractKvnc,
    deployTxHash,
    createTxHash,
    deployFee,
    createFee,
  };
}

export interface CreateNftResult {
  collectionHex: string;
  collectionKvnc: string;
  deployTxHash: string;
  collectionTxHash: string;
  mintTxHash?: string;
  tokenId?: bigint;
}

/**
 * End-to-end KVP-106 NFT collection creation + optional immediate NFT mint.
 */
export async function deployAndCreateNft(
  signer: ActiveSigner,
  params: {
    collectionName: string;
    collectionSymbol: string;
    baseUri: string;
    mintNow: boolean;
    recipient?: string;
    tokenId?: bigint;
    tokenUri?: string;
    onStatus?: (msg: string) => void;
  },
): Promise<CreateNftResult> {
  params.onStatus?.("Fetching account nonce and fee schedule…");
  const [ctx, wasmBytes] = await Promise.all([
    fetchAccountTxContext(signer.addressHex),
    loadContractWasm("kovanica-rwa.wasm"),
  ]);

  const colArgs = encodeNftCreateCollectionArgs({
    name: params.collectionName,
    symbol: params.collectionSymbol,
    baseUri: params.baseUri,
  });

  const deployTxBytes = DEPLOY_WIRE_OVERHEAD + 4 + 8 + wasmBytes.length;
  const colTxBytes =
    CALL_WIRE_OVERHEAD + 4 + 32 + 8 + 8 + "nft_create_collection".length + 8 + colArgs.length + 8;

  const deployFee = computeOperationFee("deploy", deployTxBytes, ctx.feeRate, ctx.fixedFeesActive);
  const colFee = computeOperationFee(
    "nft_create_collection",
    colTxBytes,
    ctx.feeRate,
    ctx.fixedFeesActive,
  );

  let mintFee = 0n;
  let mintArgs: Uint8Array | null = null;
  const tokenId = params.tokenId ?? 1n;
  const contractHex = deriveDeployedContractAddress(signer.addressHex, ctx.nonce);
  const contractKvnc = hexToKvnc(contractHex);

  if (params.mintNow) {
    mintArgs = encodeNftMintArgs({
      collection: contractHex,
      to: params.recipient || signer.addressHex,
      tokenId,
      tokenUri: params.tokenUri || params.baseUri,
    });
    const mintTxBytes =
      CALL_WIRE_OVERHEAD + 4 + 32 + 8 + 8 + "nft_mint".length + 8 + mintArgs.length + 8;
    mintFee = computeOperationFee("nft_mint", mintTxBytes, ctx.feeRate, ctx.fixedFeesActive);
  }

  const totalFee = deployFee + colFee + mintFee;
  if (ctx.balance < totalFee) {
    throw new Error(
      `Insufficient KVNC balance: have ${(Number(ctx.balance) / 1e9).toFixed(4)} KVNC, need ${(Number(totalFee) / 1e9).toFixed(4)} KVNC.`,
    );
  }

  params.onStatus?.("Signing NFT collection contract Deploy…");
  const deploySigned = await signDeployTx(signer, {
    nonce: ctx.nonce,
    code: wasmBytes,
    fee: deployFee,
    chainId: ctx.chainId,
  });
  const deployTxHash = await broadcastRawTx(deploySigned.rawTxHex);

  params.onStatus?.(`Deploy sent (${deployTxHash.slice(0, 12)}…). Waiting for block inclusion…`);
  const deployed = await waitForContractDeployed(contractHex, {
    onProgress: (attempt, max) =>
      params.onStatus?.(`Waiting for Deploy to be mined… (${attempt}/${max})`),
  });
  if (!deployed) {
    throw new Error(
      `Deploy transaction (${deployTxHash.slice(0, 16)}…) was not mined in time. Collection contract: ${contractKvnc}.`,
    );
  }

  params.onStatus?.("Deploy mined! Signing nft_create_collection call…");
  const colSigned = await signCallTx(signer, {
    nonce: ctx.nonce + 1n,
    contractHex,
    method: "nft_create_collection",
    args: colArgs,
    gasLimit: DEFAULT_CONTRACT_GAS_LIMIT,
    fee: colFee,
    chainId: ctx.chainId,
  });
  const collectionTxHash = await broadcastRawTx(colSigned.rawTxHex);

  let mintTxHash: string | undefined;
  if (params.mintNow && mintArgs) {
    params.onStatus?.("Collection created! Signing nft_mint call…");
    const mintSigned = await signCallTx(signer, {
      nonce: ctx.nonce + 2n,
      contractHex,
      method: "nft_mint",
      args: mintArgs,
      gasLimit: DEFAULT_CONTRACT_GAS_LIMIT,
      fee: mintFee,
      chainId: ctx.chainId,
    });
    mintTxHash = await broadcastRawTx(mintSigned.rawTxHex);
  }

  return {
    collectionHex: contractHex,
    collectionKvnc: contractKvnc,
    deployTxHash,
    collectionTxHash,
    mintTxHash,
    tokenId: params.mintNow ? tokenId : undefined,
  };
}

/** Mint an NFT into an existing KVP-106 collection contract. */
export async function mintNftInCollection(
  signer: ActiveSigner,
  params: {
    collection: string;
    to: string;
    tokenId: bigint;
    tokenUri: string;
    onStatus?: (msg: string) => void;
  },
): Promise<{ txHash: string; collectionHex: string; fee: bigint }> {
  const collectionHex = parseAddr(params.collection);
  if (!collectionHex) throw new Error("Invalid collection address");

  params.onStatus?.("Fetching account nonce and fee schedule…");
  const ctx = await fetchAccountTxContext(signer.addressHex);
  const args = encodeNftMintArgs({
    collection: collectionHex,
    to: params.to,
    tokenId: params.tokenId,
    tokenUri: params.tokenUri,
  });
  const txBytes = CALL_WIRE_OVERHEAD + 4 + 32 + 8 + 8 + "nft_mint".length + 8 + args.length + 8;
  const fee = computeOperationFee("nft_mint", txBytes, ctx.feeRate, ctx.fixedFeesActive);

  if (ctx.balance < fee) {
    throw new Error(
      `Insufficient KVNC balance: have ${(Number(ctx.balance) / 1e9).toFixed(4)} KVNC, need ${(Number(fee) / 1e9).toFixed(4)} KVNC.`,
    );
  }

  params.onStatus?.("Signing nft_mint transaction…");
  const signed = await signCallTx(signer, {
    nonce: ctx.nonce,
    contractHex: collectionHex,
    method: "nft_mint",
    args,
    gasLimit: DEFAULT_CONTRACT_GAS_LIMIT,
    fee,
    chainId: ctx.chainId,
  });

  params.onStatus?.("Broadcasting nft_mint transaction…");
  const txHash = await broadcastRawTx(signed.rawTxHex);
  return { txHash, collectionHex, fee };
}

export interface IssueRwaResult {
  contractHex: string;
  contractKvnc: string;
  assetIdHex: string;
  assetIdKvnc: string;
  deployTxHash: string;
  createTxHash: string;
  mintTxHash?: string;
}

/**
 * End-to-end KVP-106 RWA issuance:
 * 1. Deploy RWA contract bytecode
 * 2. Wait for code inclusion
 * 3. Sign & broadcast `rwa_create`
 * 4. If `recipient !== signer`, also sign & broadcast `rwa_mint` to recipient
 */
export async function deployAndIssueRwa(
  signer: ActiveSigner,
  params: {
    name: string;
    symbol: string;
    assetClass: string;
    uniqueId: string;
    version: number;
    jurisdiction: string;
    metadataHashHex: string;
    metadataUri: string;
    legalUri: string;
    custodyUri: string;
    decimals: number;
    maxSupplyAtoms: bigint;
    initialSupplyAtoms: bigint;
    recipient: string;
    onStatus?: (msg: string) => void;
  },
): Promise<IssueRwaResult> {
  const recipientHex = parseAddr(params.recipient);
  if (!recipientHex) throw new Error("Invalid recipient address");

  params.onStatus?.("Fetching account nonce and fee schedule…");
  const [ctx, wasmBytes] = await Promise.all([
    fetchAccountTxContext(signer.addressHex),
    loadContractWasm("kovanica-rwa.wasm"),
  ]);

  const mintToOther = recipientHex !== signer.addressHex;
  const createArgs = encodeRwaCreateArgs({
    name: params.name,
    symbol: params.symbol,
    assetClass: params.assetClass,
    uniqueId: params.uniqueId,
    version: params.version,
    jurisdiction: params.jurisdiction,
    metadataHashHex: params.metadataHashHex,
    metadataUri: params.metadataUri,
    legalUri: params.legalUri,
    custodyUri: params.custodyUri,
    decimals: params.decimals,
    maxSupply: params.maxSupplyAtoms,
    initialSupply: mintToOther ? 0n : params.initialSupplyAtoms,
  });

  const deployTxBytes = DEPLOY_WIRE_OVERHEAD + 4 + 8 + wasmBytes.length;
  const createTxBytes =
    CALL_WIRE_OVERHEAD + 4 + 32 + 8 + 8 + "rwa_create".length + 8 + createArgs.length + 8;

  const deployFee = computeOperationFee("deploy", deployTxBytes, ctx.feeRate, ctx.fixedFeesActive);
  const createFee = computeOperationFee("rwa_create", createTxBytes, ctx.feeRate, ctx.fixedFeesActive);

  let mintArgs: Uint8Array | null = null;
  let mintFee = 0n;
  if (mintToOther && params.initialSupplyAtoms > 0n) {
    mintArgs = encodeRwaToAmountArgs(recipientHex, params.initialSupplyAtoms);
    const mintTxBytes =
      CALL_WIRE_OVERHEAD + 4 + 32 + 8 + 8 + "rwa_mint".length + 8 + mintArgs.length + 8;
    mintFee = computeOperationFee("rwa_mint", mintTxBytes, ctx.feeRate, ctx.fixedFeesActive);
  }

  const totalFee = deployFee + createFee + mintFee;
  if (ctx.balance < totalFee) {
    throw new Error(
      `Insufficient KVNC balance: have ${(Number(ctx.balance) / 1e9).toFixed(4)} KVNC, need ${(Number(totalFee) / 1e9).toFixed(4)} KVNC.`,
    );
  }

  const contractHex = deriveDeployedContractAddress(signer.addressHex, ctx.nonce);
  const contractKvnc = hexToKvnc(contractHex);
  const derived = deriveRwaAssetId(
    signer.addressHex,
    params.assetClass,
    params.uniqueId,
    params.version,
  );

  params.onStatus?.("Signing RWA contract Deploy (1/2)…");
  const deploySigned = await signDeployTx(signer, {
    nonce: ctx.nonce,
    code: wasmBytes,
    fee: deployFee,
    chainId: ctx.chainId,
  });
  const deployTxHash = await broadcastRawTx(deploySigned.rawTxHex);

  params.onStatus?.(`Deploy sent (${deployTxHash.slice(0, 12)}…). Waiting for block inclusion…`);
  const deployed = await waitForContractDeployed(contractHex, {
    onProgress: (attempt, max) =>
      params.onStatus?.(`Waiting for Deploy to be mined… (${attempt}/${max})`),
  });
  if (!deployed) {
    throw new Error(
      `Deploy transaction (${deployTxHash.slice(0, 16)}…) was not mined in time. RWA contract: ${contractKvnc}.`,
    );
  }

  params.onStatus?.("Deploy mined! Signing rwa_create transaction (2/2)…");
  const createSigned = await signCallTx(signer, {
    nonce: ctx.nonce + 1n,
    contractHex,
    method: "rwa_create",
    args: createArgs,
    gasLimit: DEFAULT_CONTRACT_GAS_LIMIT,
    fee: createFee,
    chainId: ctx.chainId,
  });
  const createTxHash = await broadcastRawTx(createSigned.rawTxHex);

  let mintTxHash: string | undefined;
  if (mintToOther && mintArgs) {
    params.onStatus?.("RWA registered! Signing rwa_mint to recipient…");
    const mintSigned = await signCallTx(signer, {
      nonce: ctx.nonce + 2n,
      contractHex,
      method: "rwa_mint",
      args: mintArgs,
      gasLimit: DEFAULT_CONTRACT_GAS_LIMIT,
      fee: mintFee,
      chainId: ctx.chainId,
    });
    mintTxHash = await broadcastRawTx(mintSigned.rawTxHex);
  }

  return {
    contractHex,
    contractKvnc,
    assetIdHex: derived.assetIdHex,
    assetIdKvnc: derived.assetIdKvnc,
    deployTxHash,
    createTxHash,
    mintTxHash,
  };
}

// --- Local Token Watchlist Helper ---------------------------------------------

export function watchTokenContract(contractHex: string): string[] {
  if (typeof window === "undefined") return [];
  const normalized = parseAddr(contractHex) ?? contractHex.trim().toLowerCase();
  try {
    const raw = window.localStorage.getItem(WATCHED_TOKENS_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!list.includes(normalized)) {
      list.unshift(normalized);
      window.localStorage.setItem(WATCHED_TOKENS_KEY, JSON.stringify(list));
    }
    return list;
  } catch {
    return [normalized];
  }
}
