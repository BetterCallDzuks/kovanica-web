import { SPEC_TEXT } from "./spec";
import {
  ATOM,
  DECIMALS,
  FOUNDER_AMOUNT,
  HALVING_ERA,
  MAX_SUPPLY,
  MIN_FEE,
  NETWORK_ID,
  SUBSIDY,
  TOKEN,
  getSpecText,
} from "../networkConstants";
import {
  localBlocksDump,
  localBootstrap,
  localContractCall,
  localContractReceipt,
  localContractStorage,
  localFaucet,
  localHead,
  localHistory,
  localMine,
  localMiner,
  localMining,
  localOrigin,
  localOrigins,
  localP2p,
  localPrepare,
  localProduce,
  localFeeEstimate,
  localReset,
  localState,
  localSubmit,
  localUtxos,
} from "./node.server";
import { type ApiSource, type ApiState, type ApiHead, type ApiBootstrap } from "./contract";
import { encodeAddress, parseAddr, toCanonicalAddress } from "../wallet/address";
import { listPools, listTokens, getTokenState } from "./tokens.server";
import { balanceOf } from "../tokens/codec";
import { blake3 } from "@noble/hashes/blake3.js";
import { classifyHealth, type HealthSummary } from "./health";
import { parseTargetBits } from "@/lib/explorer/mining-metrics";
import { faucetEndpoint, probeHealth, rpcCall, rpcEndpoint, RpcError, type HealthProbeResult } from "./rpc-url.server";
import { fetchLiveDagBlocks } from "./live-dag.server";
import { dispenseFromFaucet, FaucetError, faucetHttpStatus } from "./faucet.server";
import { isAssetId } from "../asset-id";
import { DEFAULT_RWA_REGISTRY } from "../rwa/compliance";
import {
  buildContractCallRequest,
  buildContractReceiptRequest,
  buildContractStorageRequest,
  isStorageBytesEmpty,
  type ContractCallRequest,
  type ContractCallResponse,
  type ContractReceiptResponse,
  type ContractStorageResponse,
  type RawContractTransactionReceipt,
} from "../contracts/dry-run";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-kovanica-source",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function json(data: unknown, status = 200): Response {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
  );
}

function text(msg: string, status: number): Response {
  return withCors(new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8" } }));
}

function sourceOf(req: Request): ApiSource {
  const url = new URL(req.url);
  const q = url.searchParams.get("source");
  const h = req.headers.get("x-kovanica-source");
  const v = (q ?? h ?? "").toLowerCase();
  if (v === "local") return "local";
  if (v === "mainnet") return "mainnet";
  return "testnet";
}

function action(pathname: string): string {
  const rest = pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  return rest.split("/")[0] ?? "";
}

/** Same flat fee the native prepare path uses; token calls are one storage write. */
const TOKEN_FEE = 10_000;
/** Fuel cap, not a charge. 5M is far above a transfer and below MAX_TX_GAS_LIMIT. */
const TOKEN_GAS_LIMIT = 5_000_000;
const MAX_U128 = (1n << 128n) - 1n;

/** Classify a liveness probe into the shared health vocabulary. */
function summarise(probe: HealthProbeResult): HealthSummary {
  return {
    state: classifyHealth({ healthStatus: probe.status, failed: probe.failed }),
    status: probe.status,
    checkedAt: probe.checkedAt,
  };
}

/** Read + write calls go straight to seed1; no token, no Authorization header. */
function callRpc<T = any>(method: string, params: unknown[] = []): Promise<T> {
  return rpcCall<T>(method, params);
}

/**
 * NFT / RWA / collection detail lookup. A malformed id is 400, an unknown id
 * 404, a node that does not serve the lookup 501, a stalled chain 503 and any
 * other upstream failure 502 — a missing id never surfaces as a 5xx.
 */
async function detailLookup(rpcMethod: string, rawId: string): Promise<Response> {
  let id: string;
  try {
    id = decodeURIComponent(rawId).trim();
  } catch {
    return text("invalid id: expected 32-byte hex", 400);
  }
  if (!isAssetId(id)) return text("invalid id: expected 32-byte hex", 400);
  try {
    const res = await callRpc(rpcMethod, [id]);
    if (!res) return text("not found", 404);
    return json(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/method not found/i.test(msg)) {
      return text(`lookup not served by the testnet node (${rpcMethod})`, 501);
    }
    if (/not found|unknown (asset|collection)/i.test(msg)) return text("not found", 404);
    return text(`testnet node error: ${msg}`, rpcFailureStatus(e));
  }
}

/** 503 is a stalled chain; everything else (transport, 5xx) is down. */
function rpcFailureStatus(error: unknown): 503 | 502 {
  return error instanceof RpcError && error.status === 503 ? 503 : 502;
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function asciiPad(text: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const bytes = new TextEncoder().encode(text);
  out.set(bytes);
  return out;
}
const TX_DOMAIN = asciiPad("KVNC/tx/v1", 16);
const TX_KEY = asciiPad("KVNC-TX-v1", 32);

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64le(value: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function signingHash(
  sender: Uint8Array,
  nonce: bigint | number,
  to: Uint8Array,
  amount: bigint | number,
  fee: bigint | number,
  chainId = 2,
): Uint8Array {
  const kindBytes = concat([Uint8Array.of(0), to, u64le(amount)]);
  return signingHashForKind(sender, nonce, kindBytes, fee, chainId);
}

/**
 * Signing preimage shared by every kind: domain tag, chain id, sender, nonce,
 * the kind bytes exactly as `Transaction::signing_hash` serializes them, fee.
 */
function signingHashForKind(
  sender: Uint8Array,
  nonce: bigint | number,
  kindBytes: Uint8Array,
  fee: bigint | number,
  chainId = 2,
): Uint8Array {
  const preimage = concat([
    TX_DOMAIN,
    u64le(chainId),
    sender,
    u64le(nonce),
    kindBytes,
    u64le(fee),
  ]);
  return blake3(preimage, { key: TX_KEY });
}

function u128le(value: bigint): Uint8Array {
  const out = new Uint8Array(16);
  let rest = value;
  for (let i = 0; i < 16; i += 1) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function encodeRawTransaction(
  sender: Uint8Array,
  nonce: bigint | number,
  to: Uint8Array,
  amount: bigint | number,
  fee: bigint | number,
  signature: Uint8Array,
  hash: Uint8Array,
): string {
  const kindBytes = concat([u32le(0), to, u64le(amount)]);
  return encodeRawTransactionForKind(sender, nonce, kindBytes, fee, signature, hash);
}

/** bincode of `Transaction`: sender ‖ nonce ‖ kind ‖ fee ‖ bytes(sig) ‖ hash. */
function encodeRawTransactionForKind(
  sender: Uint8Array,
  nonce: bigint | number,
  kindBytes: Uint8Array,
  fee: bigint | number,
  signature: Uint8Array,
  hash: Uint8Array,
): string {
  const body = concat([
    sender,
    u64le(nonce),
    kindBytes,
    u64le(fee),
    u64le(64n),
    signature,
    hash,
  ]);
  return [...body].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(raw.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchLiveState(): Promise<ApiState> {
  const [sync, tips, mining, pending, probe] = await Promise.all([
    callRpc<any>("kovanica_syncStatus"),
    callRpc<any>("kovanica_getDagTips").catch(() => null),
    callRpc<any>("kovanica_getMiningInfo").catch(() => null),
    callRpc<any>("kovanica_getPendingTransactions").catch(() => null),
    probeHealth(),
  ]);

  const currentHeight = numberOrNull(sync?.committedHeight) ?? 0;
  const tipList: string[] = Array.isArray(tips?.tips) ? tips.tips.filter((t: unknown) => typeof t === "string") : [];
  const peers: any[] = Array.isArray(sync?.peers) ? sync.peers : [];
  const peerIds: string[] = peers
    .map((p) => (typeof p?.peerId === "string" ? p.peerId : null))
    .filter((id: string | null): id is string => id !== null);
  const pendingIds: string[] = Array.isArray(pending)
    ? pending
        .map((tx) => (typeof tx === "string" ? tx : tx?.hash ?? tx?.tx_hash ?? null))
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    : [];
  const mempool = Array.isArray(pending) ? pendingIds.length : null;

  const dag = await fetchLiveDagBlocks({
    committedHeight: currentHeight,
    tips: tipList,
    callRpc,
    cacheScope: rpcEndpoint(),
  });
  const health = summarise(probe);

  const rawDifficulty =
    typeof mining?.difficulty === "number"
      ? mining.difficulty
      : typeof mining?.difficulty === "string"
        ? Number(mining.difficulty)
        : null;
  const difficulty =
    typeof rawDifficulty === "number" && Number.isFinite(rawDifficulty) && rawDifficulty > 0
      ? rawDifficulty
      : null;
  const miningInfo = mining
    ? {
        target_bits: parseTargetBits(mining.target_bits ?? mining.targetBits),
        difficulty,
        target_block_time_ms:
          numberOrNull(mining.target_block_time_ms) ??
          numberOrNull(mining.target_interval_ms) ??
          numberOrNull(mining.targetBlockTimeMs),
        ghostdag_k:
          numberOrNull(mining.ghostdag_k) ?? numberOrNull(tips?.ghostdag_k),
        mining_enabled:
          typeof mining.mining_enabled === "boolean" ? mining.mining_enabled : null,
        pow_algorithm:
          typeof mining.pow_algorithm === "string" ? mining.pow_algorithm : null,
      }
    : null;

  return {
    selected: tipList[0] ?? null,
    mining: typeof mining?.mining_enabled === "boolean" ? mining.mining_enabled : null,
    faucet: faucetEndpoint() !== null,
    // The public testnet never allows reset; dispatch rejects it before this.
    allow_reset: false,
    operator: false,
    network: NETWORK_ID,
    chain_id: numberOrNull(tips?.chain_id) ?? numberOrNull(mining?.chain_id) ?? null,
    health,
    listen: null,
    peers: peerIds,
    mesh: {
      // Snapshot timestamp of this response, not a block timestamp.
      now: Date.now(),
      queued: mempool,
      nodes: peers.map((p) => ({
        name: typeof p?.peerId === "string" ? p.peerId : "unknown",
        blocks: null,
        tip: null,
        peers: [],
        mempool: null,
      })),
      events: [],
    },
    node: {
      blocks: currentHeight,
      tips: tipList,
      selected_tip: tipList[0] ?? null,
      blue_score: null,
      blue_work: null,
      k: numberOrNull(tips?.ghostdag_k) ?? numberOrNull(mining?.ghostdag_k) ?? 5,
      subsidy: SUBSIDY,
      issuance: null,
      halving_era: HALVING_ERA,
      min_fee: MIN_FEE,
      genesis: null,
      supply: null,
      token: TOKEN,
      decimals: DECIMALS,
      miner: null,
      atom: ATOM,
      ui: "hybrid",
      utxos: null,
      chain_len: numberOrNull(sync?.localTipRound),
      mempool,
      tx_count: null,
      mining_info: miningInfo,
      dag,
      order: dag.map((d) => d.id),
      pending: pendingIds,
    },
    wallets: [],
    source: "testnet",
  };
}

async function fetchLiveBootstrap(): Promise<ApiBootstrap> {
  const head = await fetchLiveHead();
  const [sync, probe] = await Promise.all([callRpc<any>("kovanica_syncStatus"), probeHealth()]);
  const health = summarise(probe);
  const peers: string[] = Array.isArray(sync?.peers)
    ? sync.peers
        .map((p: any) => (typeof p?.peerId === "string" ? p.peerId : null))
        .filter((id: string | null): id is string => id !== null)
    : [];
  return {
    ...head,
    network: NETWORK_ID,
    chain_id: head.chain_id ?? null,
    genesis: head.genesis,
    tip: head.tip,
    blocks: head.blocks,
    admission: "open",
    poa_enabled: false,
    atom: ATOM,
    token: TOKEN,
    k: head.k ?? 5,
    subsidy: SUBSIDY,
    min_fee: MIN_FEE,
    finality_depth: head.finality_depth,
    // Not exposed by seed1: null renders as "n/a".
    block_pruning_depth: null,
    payload_pruning_depth: null,
    founder_amount: 200_000 * ATOM,
    founder_seed: 1,
    max_supply: MAX_SUPPLY,
    burned: null,
    circulating: null,
    native_minted: null,
    total: MAX_SUPPLY,
    listen: null,
    peers,
    health,
    upstream:
      health.state === "live"
        ? { ok: true, head }
        : {
            ok: false,
            error: health.state === "stalled" ? "Stalled — chain not advancing" : "Down",
          },
  } as ApiBootstrap;
}

async function fetchLiveHead(): Promise<ApiHead> {
  const [sync, tips, mining, probe] = await Promise.all([
    callRpc<any>("kovanica_syncStatus"),
    callRpc<any>("kovanica_getDagTips").catch(() => null),
    callRpc<any>("kovanica_getMiningInfo").catch(() => null),
    probeHealth(),
  ]);
  const currentHeight = numberOrNull(sync?.committedHeight) ?? 0;
  const tipList: string[] = Array.isArray(tips?.tips) ? tips.tips.filter((t: unknown) => typeof t === "string") : [];
  return {
    network: NETWORK_ID,
    chain_id: numberOrNull(tips?.chain_id) ?? numberOrNull(mining?.chain_id) ?? null,
    // seed1 exposes no genesis-hash method; "n/a" beats a hardcoded digest.
    genesis: null,
    tip: tipList[0] ?? null,
    blocks: currentHeight,
    min_fee: MIN_FEE,
    atom: ATOM,
    // seed1 exposes no finality-depth method; null renders as "n/a".
    finality_depth: null,
    k: numberOrNull(tips?.ghostdag_k) ?? numberOrNull(mining?.ghostdag_k) ?? 5,
    health: summarise(probe),
  } as ApiHead;
}

async function fetchLiveUtxos(address: string): Promise<any> {
  const canonical = toCanonicalAddress(address) || address;
  const balHex = await callRpc<string>("kovanica_getBalance", [canonical]);
  const balance = typeof balHex === "string" ? parseInt(balHex, 16) : 0;
  // Read RPCs report a balance, not a UTXO set. Never invent an outpoint.
  return { address, balance, utxos: [] };
}

async function fetchLiveHistory(address: string): Promise<any> {
  try {
    const canonical = toCanonicalAddress(address) || address;
    const [history, balHex] = await Promise.all([
      callRpc<any>("kovanica_getTransactionHistory", [canonical, 20]).catch(() => []),
      callRpc<string>("kovanica_getBalance", [canonical]).catch(() => "0x0"),
    ]);
    const balance = typeof balHex === "string" ? parseInt(balHex, 16) : 0;
    return {
      address,
      balance,
      txs: Array.isArray(history) ? history.map((h: any) => ({
        tx: h.hash || h.tx_hash || "",
        block: h.blockNumber ? String(parseInt(h.blockNumber, 16)) : "latest",
        kind: h.from === address ? "out" : "in",
        delta: h.amount ? parseInt(h.amount, 16) : 0,
        asset_id: null,
      })) : [],
    };
  } catch {
    return { address, balance: 0, txs: [] };
  }
}

async function fetchLiveFeeEstimate(): Promise<any> {
  const [fee, pending] = await Promise.all([
    callRpc<any>("kovanica_estimateFee").catch(() => null),
    callRpc<any>("kovanica_getPendingTransactions").catch(() => null),
  ]);
  const feeRate = typeof fee === "string" ? parseInt(fee, 16) : typeof fee === "number" ? fee : MIN_FEE;
  return {
    fee_rate: Number.isFinite(feeRate) ? feeRate : MIN_FEE,
    unit: "atoms",
    mempool: Array.isArray(pending) ? pending.length : null,
  };
}

/**
 * Forward a dispense request to the faucet. The client IP travels in
 * `X-Forwarded-For` (proxy-attested only, see `client-ip.server.ts`); the amount
 * and the wording come back from the faucet, never from this side.
 */
async function handleLiveFaucet(to: string, reqHeaders: Headers): Promise<any> {
  const canonical = toCanonicalAddress(to) || to;
  return dispenseFromFaucet(canonical, reqHeaders);
}

function parseHexQuantity(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  const parsed = trimmed.startsWith("0x") || trimmed.startsWith("0X")
    ? Number.parseInt(trimmed.slice(2), 16)
    : Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function hexByteLength(hex: unknown): number | null {
  if (typeof hex !== "string") return null;
  const clean = hex.trim().replace(/^0x/i, "");
  if (clean.length === 0) return 0;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  return clean.length / 2;
}

/**
 * Execute a read-only contract dry-run against the live testnet node via
 * `kovanica_call`, `kovanica_estimateGas`, and `kovanica_getCode`.
 */
async function executeLiveContractCall(req: Request): Promise<Response> {
  let body: Partial<Record<keyof ContractCallRequest, unknown>>;
  try {
    body = (await req.json()) as Partial<Record<keyof ContractCallRequest, unknown>>;
  } catch {
    return text("invalid JSON body", 400);
  }

  const built = buildContractCallRequest(body);
  if (!built.ok) {
    return text(built.error, 400);
  }

  const { call } = built;
  const rpcObj: Record<string, unknown> = {
    to: call.to,
    data: call.data,
  };
  if (call.from) rpcObj.from = call.from;
  if (call.entry) rpcObj.entry = call.entry;
  if (call.value) rpcObj.value = call.value;
  if (call.gas) rpcObj.gas = call.gas;

  const started = Date.now();
  const codePromise = callRpc<string>("kovanica_getCode", [call.to]).catch(() => null);

  try {
    const [outputHex, gasHex, codeHex] = await Promise.all([
      callRpc<string>("kovanica_call", [rpcObj]),
      callRpc<string>("kovanica_estimateGas", [rpcObj]).catch(() => null),
      codePromise,
    ]);
    const normalizedOut =
      typeof outputHex === "string"
        ? outputHex.startsWith("0x") || outputHex.startsWith("0X")
          ? outputHex.toLowerCase()
          : `0x${outputHex.toLowerCase()}`
        : "0x";
    const resp: ContractCallResponse = {
      ok: true,
      reverted: false,
      outputHex: normalizedOut,
      gasUsed: parseHexQuantity(gasHex),
      codeBytes: hexByteLength(codeHex),
      latencyMs: Math.max(1, Date.now() - started),
      source: "testnet",
      rpcMethod: "kovanica_call",
      call,
    };
    return json(resp);
  } catch (e) {
    const codeHex = await codePromise;
    const codeBytes = hexByteLength(codeHex);
    const latencyMs = Math.max(1, Date.now() - started);

    // HTTP 200 from JSON-RPC means the node answered with a JSON-RPC error (e.g. execution revert)
    if (e instanceof RpcError && e.status === 200) {
      const resp: ContractCallResponse = {
        ok: false,
        reverted: true,
        error: e.message,
        codeBytes,
        latencyMs,
        source: "testnet",
        rpcMethod: "kovanica_call",
        call,
      };
      return json(resp);
    }

    const msg = e instanceof Error ? e.message : "contract dry-run failed";
    return text(`testnet node error: ${msg}`, rpcFailureStatus(e));
  }
}

/**
 * Read a contract storage slot from the live testnet node via
 * `kovanica_getStorageAt(contract, slotHex)` and `kovanica_getCode(contract)`.
 */
async function executeLiveContractStorage(req: Request): Promise<Response> {
  let body: Partial<Record<string, unknown>>;
  try {
    body = (await req.json()) as Partial<Record<string, unknown>>;
  } catch {
    return text("invalid JSON body", 400);
  }

  const built = buildContractStorageRequest(body);
  if (!built.ok) {
    return text(built.error, 400);
  }

  const { query } = built;
  const started = Date.now();

  try {
    const [rawStorageHex, codeHex] = await Promise.all([
      callRpc<string>("kovanica_getStorageAt", [query.contract, query.slotHex]),
      callRpc<string>("kovanica_getCode", [query.contract]).catch(() => null),
    ]);

    const normalizedHex =
      typeof rawStorageHex === "string" && rawStorageHex.trim().length > 0
        ? rawStorageHex.trim().startsWith("0x") || rawStorageHex.trim().startsWith("0X")
          ? rawStorageHex.trim().toLowerCase()
          : `0x${rawStorageHex.trim().toLowerCase()}`
        : "0x";

    const byteLen = hexByteLength(normalizedHex) ?? 0;
    const rawBytes = byteLen > 0 ? hexToBytes(normalizedHex) : new Uint8Array(0);
    const emptyCheck = isStorageBytesEmpty(rawBytes);

    const resp: ContractStorageResponse = {
      ok: true,
      storageHex: normalizedHex,
      isEmpty: emptyCheck.isEmpty,
      byteLength: byteLen,
      codeBytes: hexByteLength(codeHex),
      latencyMs: Math.max(1, Date.now() - started),
      source: "testnet",
      rpcMethod: "kovanica_getStorageAt",
      query,
    };
    return json(resp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "contract storage read failed";
    return text(`testnet node error: ${msg}`, rpcFailureStatus(e));
  }
}

/**
 * Fetch a transaction receipt and its emitted logs from the live testnet node via
 * `kovanica_getTransactionReceipt(txHash)`.
 */
async function executeLiveContractReceipt(req: Request): Promise<Response> {
  let body: Partial<Record<string, unknown>>;
  try {
    body = (await req.json()) as Partial<Record<string, unknown>>;
  } catch {
    return text("invalid JSON body", 400);
  }

  const built = buildContractReceiptRequest(body);
  if (!built.ok) {
    return text(built.error, 400);
  }

  const { query } = built;
  const started = Date.now();

  try {
    const rawReceipt = await callRpc<RawContractTransactionReceipt | null>(
      "kovanica_getTransactionReceipt",
      [query.txHash],
    );
    const found = rawReceipt !== null && typeof rawReceipt === "object";
    const resp: ContractReceiptResponse = {
      ok: true,
      found,
      receipt: found ? rawReceipt : null,
      latencyMs: Math.max(1, Date.now() - started),
      source: "testnet",
      rpcMethod: "kovanica_getTransactionReceipt",
      query,
    };
    return json(resp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "contract receipt read failed";
    return text(`testnet node error: ${msg}`, rpcFailureStatus(e));
  }
}

const RWA_ASSET_CLASSES = new Set(["RE", "BOND", "INVOICE", "COMMODITY", "FUND", "OTHER"]);
const MAX_RWA_UNIQUE_ID_BYTES = 128;

async function handleRwaDerive(
  req: Request,
  q: URLSearchParams,
  method: string,
): Promise<Response> {
  if (method !== "POST") return text("method not allowed", 405);

  let body: Record<string, unknown> = {};
  if (!q.has("issuer") && req.body !== null) {
    try {
      const parsed = (await req.json()) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      return text("invalid JSON body", 400);
    }
  }

  const rawIssuer = q.get("issuer") ?? (typeof body.issuer === "string" ? body.issuer : "");
  const rawClass =
    q.get("class") ??
    q.get("asset_class") ??
    (typeof body.class === "string"
      ? body.class
      : typeof body.asset_class === "string"
        ? body.asset_class
        : "");
  const rawUniqueId =
    q.get("id") ??
    q.get("unique_id") ??
    (typeof body.id === "string"
      ? body.id
      : typeof body.unique_id === "string"
        ? body.unique_id
        : "");
  const rawVersionParam = q.get("version");
  const rawVersion =
    rawVersionParam !== null
      ? rawVersionParam
      : body.version !== undefined && body.version !== null
        ? String(body.version)
        : "1";

  const issuerHex = parseAddr(rawIssuer);
  if (!issuerHex) {
    return text("invalid issuer address: expected 64-hex or kvnc…dag", 400);
  }
  const assetClass = rawClass.trim();
  if (!RWA_ASSET_CLASSES.has(assetClass)) {
    return text(
      "invalid asset class: expected RE, BOND, INVOICE, COMMODITY, FUND, or OTHER",
      400,
    );
  }
  const uniqueId = rawUniqueId.trim();
  const enc = new TextEncoder();
  const uniqueIdBytes = enc.encode(uniqueId);
  if (uniqueIdBytes.length === 0 || uniqueIdBytes.length > MAX_RWA_UNIQUE_ID_BYTES) {
    return text("invalid unique_id: must be 1..128 UTF-8 bytes", 400);
  }
  if (!/^\d+$/.test(rawVersion.trim())) {
    return text("invalid version: expected positive 32-bit integer", 400);
  }
  const versionNum = Number(rawVersion.trim());
  if (!Number.isInteger(versionNum) || versionNum < 1 || versionNum > 0xffff_ffff) {
    return text("invalid version: expected positive 32-bit integer (1..4294967295)", 400);
  }

  const preimage = concat([
    enc.encode("kvp106:rwa:v1"),
    hexToBytes(issuerHex),
    Uint8Array.of(0),
    enc.encode(assetClass),
    Uint8Array.of(0),
    uniqueIdBytes,
    u32le(versionNum),
  ]);
  const digest = blake3(preimage);
  return json({
    asset_id: bytesToHex(digest),
    asset_id_kvnc: encodeAddress(digest),
  });
}

export async function dispatchApi(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

  const url = new URL(req.url);
  const name = action(url.pathname);
  const q = url.searchParams;
  const method = req.method.toUpperCase();

  const source = sourceOf(req);

  if (name === "spec") {
    const spec = source === "mainnet" ? getSpecText("mainnet") : SPEC_TEXT;
    return withCors(
      new Response(spec, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }),
    );
  }

  // Mainnet has no public RPC endpoint prior to 1.1.2027 genesis launch
  // Network isolation: mainnet must not silently query testnet node or submit transactions.
  if (source === "mainnet") {
    if (method === "POST") {
      return text("mainnet transactions disabled prior to 1.1.2027 launch", 403);
    }
    return text("mainnet launching soon", 503);
  }

  // When querying testnet (or public by default)
  if (source === "testnet") {
    if (name === "reset" || name === "mine" || name === "mining") {
      return text("not allowed on public testnet", 403);
    }
    // Liveness document: always 200 with a `state`. 503 = stalled, distinct from down.
    if (name === "health") {
      const probe = await probeHealth();
      return json({
        state: classifyHealth({ healthStatus: probe.status, failed: probe.failed }),
        status: probe.status,
        checkedAt: probe.checkedAt,
      });
    }
    if (name === "state") {
      try {
        return json(await fetchLiveState());
      } catch (e) {
        return text(`testnet node error: ${e instanceof Error ? e.message : e}`, rpcFailureStatus(e));
      }
    }
    if (name === "bootstrap") {
      try {
        return json(await fetchLiveBootstrap());
      } catch (e) {
        return text(`testnet node error: ${e instanceof Error ? e.message : e}`, rpcFailureStatus(e));
      }
    }
    if (name === "head") {
      try {
        return json(await fetchLiveHead());
      } catch (e) {
        return text(`testnet node error: ${e instanceof Error ? e.message : e}`, rpcFailureStatus(e));
      }
    }
    if (name === "supply") {
      if (method !== "GET") return text("method not allowed", 405);
      try {
        const [sync, probe] = await Promise.all([
          callRpc<any>("kovanica_syncStatus"),
          probeHealth(),
        ]);
        const currentHeight = numberOrNull(sync?.committedHeight) ?? 0;
        return json({
          network: NETWORK_ID,
          token: TOKEN,
          decimals: DECIMALS,
          atom: ATOM,
          blocks: currentHeight,
          max_supply: MAX_SUPPLY,
          founder_amount: FOUNDER_AMOUNT,
          treasury_total: 8_000_000 * ATOM,
          mining_subsidy_budget: 82_000_000 * ATOM,
          subsidy: SUBSIDY,
          halving_era: HALVING_ERA,
          circulating: null,
          burned: null,
          native_minted: null,
          source: "testnet",
          health: summarise(probe),
        });
      } catch (e) {
        return text(`testnet node error: ${e instanceof Error ? e.message : e}`, rpcFailureStatus(e));
      }
    }
    if (name === "utxos") {
      const addr = q.get("address") ?? "";
      try {
        return json(await fetchLiveUtxos(addr));
      } catch (e) {
        return text(`testnet node error: ${e instanceof Error ? e.message : e}`, rpcFailureStatus(e));
      }
    }
    if (name === "history") {
      const addr = q.get("address") ?? "";
      return json(await fetchLiveHistory(addr));
    }
    if (name === "fee_estimate") {
      return json(await fetchLiveFeeEstimate());
    }
    if (name === "fee_schedule") {
      try {
        const res = await callRpc<Record<string, unknown>>("kovanica_getFeeSchedule", []);
        return json(res);
      } catch {
        const { FIXED_FEES } = await import("../networkConstants");
        return json({
          fee_split_burn_bps: 7500,
          fee_split_miner_bps: 2500,
          fixed_fees: {
            deploy: `0x${FIXED_FEES.deploy.toString(16)}`,
            token_create: `0x${FIXED_FEES.token_create.toString(16)}`,
            nft_create_collection: `0x${FIXED_FEES.nft_create_collection.toString(16)}`,
            nft_mint: `0x${FIXED_FEES.nft_mint.toString(16)}`,
            rwa_create: `0x${FIXED_FEES.rwa_create.toString(16)}`,
            rwa_mint: `0x${FIXED_FEES.rwa_mint.toString(16)}`,
          },
        });
      }
    }
    if (name === "base_fee") {
      try {
        const res = await callRpc<Record<string, unknown>>("kovanica_getBaseFee", []);
        return json(res);
      } catch {
        return json({
          base_fee_per_byte: "0x1",
          min_base_fee_per_byte: "0x1",
          max_base_fee_per_byte: "0x186a0",
          target_block_bytes: "0x40000",
          storage_deposit_per_byte: "0x186a0",
          default_gas_price_atoms: "0x1",
        });
      }
    }
    if (name === "storage_deposit") {
      const contract = q.get("contract") ?? "";
      if (!contract) return text("missing contract query parameter", 400);
      try {
        const res = await callRpc<Record<string, unknown>>("kovanica_getStorageDeposit", [contract]);
        return json(res);
      } catch {
        return json({
          contract,
          bytes: "0x0",
          deposit_atoms: "0x0",
          deposit_per_byte: "0x186a0",
        });
      }
    }
    if (name === "contract_call") {
      if (method !== "POST") return text("method not allowed", 405);
      return executeLiveContractCall(req);
    }
    if (name === "contract_storage") {
      if (method !== "POST") return text("method not allowed", 405);
      return executeLiveContractStorage(req);
    }
    if (name === "contract_receipt") {
      if (method !== "POST") return text("method not allowed", 405);
      return executeLiveContractReceipt(req);
    }
    if (name === "rwa") {
      const sub = url.pathname.replace(/^\/api\/rwa\/?/, "").replace(/\/$/, "");
      if (sub === "registry" || sub === "list" || sub === "") {
        try {
          const live = await callRpc<unknown[]>("kovanica_listRwaAssets", []);
          if (Array.isArray(live) && live.length > 0) {
            return json({ source: "rpc", standard: "KVP-106", assets: live });
          }
        } catch {
          // Node may not expose kovanica_listRwaAssets yet; fall back to institutional registry
        }
        return json({
          source: "registry",
          standard: "KVP-106",
          assets: DEFAULT_RWA_REGISTRY,
        });
      }
      if (sub.startsWith("compliance/")) {
        const assetId = sub.slice("compliance/".length).trim();
        const found = DEFAULT_RWA_REGISTRY.find(
          (a) => a.assetId === assetId || a.contractAddress === assetId,
        );
        if (!found) {
          return detailLookup("kovanica_getRwaAsset", assetId);
        }
        return json({
          standard: "KVP-106",
          asset: found,
        });
      }
      if (sub === "derive") {
        return handleRwaDerive(req, q, method);
      }
      if (sub === "mint" && method === "POST") {
        const assetId = q.get("asset_id") ?? "";
        const to = q.get("to") ?? "";
        const amount = Number(q.get("amount") ?? "0");
        const metadataHash = q.get("metadata_hash") ?? "";
        const fee = Number(q.get("fee") ?? "0");
        if (!assetId || !to || !Number.isFinite(amount) || amount <= 0 || !metadataHash) {
          return text("missing required RWA mint parameters (asset_id, to, amount, metadata_hash)", 400);
        }
        return json({
          status: "prepared",
          standard: "KVP-106",
          asset_id: assetId,
          to,
          amount,
          metadata_hash: metadataHash,
          fee,
          tx_hash: assetId,
        });
      }
      return detailLookup("kovanica_getRwaAsset", sub);
    }
    if (name === "collection") {
      return detailLookup("kovanica_getCollection", url.pathname.replace(/^\/api\/collection\/?/, ""));
    }
    if (name === "nft") {
      return detailLookup("kovanica_getNftAsset", url.pathname.replace(/^\/api\/nft\/?/, ""));
    }
    if (name === "tokens") {
      try {
        const holder = parseAddr(q.get("address") ?? "");
        return json(await listTokens(holder ?? undefined));
      } catch (e) {
        return text(`token scan failed: ${e instanceof Error ? e.message : e}`, 502);
      }
    }
    if (name === "pools") {
      try {
        return json(await listPools());
      } catch (e) {
        return text(`pool scan failed: ${e instanceof Error ? e.message : e}`, 502);
      }
    }
    if (name === "token_prepare" || name === "token_submit") {
      try {
        const from = q.get("from") ?? "";
        const token = q.get("token") ?? "";
        const to = q.get("to") ?? "";
        const amountText = (q.get("amount") ?? "").trim();

        const fromHex = parseAddr(from);
        const toHex = parseAddr(to);
        const tokenHex = parseAddr(token);
        if (!fromHex) return text("invalid sender address", 400);
        if (!toHex) return text("invalid recipient address", 400);
        if (!tokenHex) return text("invalid token contract address", 400);
        if (!/^\d+$/.test(amountText)) {
          return text("amount must be a whole number of token base units", 400);
        }

        const amount = BigInt(amountText);
        if (amount <= 0n || amount > MAX_U128) return text("amount out of range", 400);

        const tokenCanonical = toCanonicalAddress(tokenHex)!;
        const state = await getTokenState(tokenCanonical);
        if (!state) return text("no token at that contract address", 400);
        if (state.paused) return text(`${state.symbol} is paused`, 400);

        const held = balanceOf(state, fromHex);
        if (held < amount) {
          return text(`Insufficient ${state.symbol}: balance ${held}, need ${amount}`, 400);
        }

        const fromCanonical = toCanonicalAddress(fromHex)!;
        const nativeHex = await callRpc("kovanica_getBalance", [fromCanonical]);
        const nativeBalance = BigInt(nativeHex ?? "0x0");
        if (nativeBalance < BigInt(TOKEN_FEE)) {
          return text(`Need at least ${TOKEN_FEE} atoms of KVNC for the fee`, 400);
        }

        const nonceHex = await callRpc("kovanica_getNonce", [fromCanonical]);
        const nonce = BigInt(nonceHex || "0x0");

        const fromBytes = hexToBytes(fromHex);
        const toBytes = hexToBytes(toHex);
        const contractBytes = hexToBytes(tokenHex);
        const methodBytes = new TextEncoder().encode("token_transfer");
        // `token_transfer` takes bincode `([u8; 32] to, u128 amount)`.
        const args = concat([toBytes, u128le(amount)]);

        const sighashKind = concat([
          Uint8Array.of(4),
          contractBytes,
          u64le(0),
          u64le(BigInt(methodBytes.length)),
          methodBytes,
          u64le(BigInt(args.length)),
          args,
          u64le(TOKEN_GAS_LIMIT),
        ]);
        const hash = signingHashForKind(fromBytes, nonce, sighashKind, TOKEN_FEE, 2);
        const sighashHex = bytesToHex(hash);

        if (name === "token_prepare") {
          return json({
            ok: true,
            sighash: sighashHex,
            token: tokenCanonical,
            symbol: state.symbol,
            decimals: state.decimals,
            amount: amount.toString(),
            fee: TOKEN_FEE,
            gas_limit: TOKEN_GAS_LIMIT,
          });
        }

        let sig = q.get("sig") ?? "";
        if (!sig && method === "POST") {
          try {
            const body = await req.json();
            sig = body.sig || body.signature || "";
          } catch {}
        }
        if (!sig) return text("missing signature", 400);
        const sigBytes = hexToBytes(sig);
        if (sigBytes.length !== 64) return text("signature must be 64 bytes", 400);

        const rawKind = concat([
          u32le(4),
          contractBytes,
          u64le(0),
          u64le(BigInt(methodBytes.length)),
          methodBytes,
          u64le(BigInt(args.length)),
          args,
          u64le(TOKEN_GAS_LIMIT),
        ]);
        const rawHex = encodeRawTransactionForKind(
          fromBytes,
          nonce,
          rawKind,
          TOKEN_FEE,
          sigBytes,
          hash,
        );
        const txHash = await callRpc("kovanica_sendRawTransaction", [rawHex]);
        return json({ ok: true, tx: txHash });
      } catch (e) {
        if (e instanceof RpcError && e.status === 401) {
          return text("writes are not available via the public RPC", 403);
        }
        return text(e instanceof Error ? e.message : "token send failed", 400);
      }
    }
    if (name === "faucet") {
      try {
        let to = q.get("to");
        if (!to && method === "POST") {
          try {
            const body = await req.json();
            to = body.address || body.to;
          } catch {}
        }
        if (!to) return text("missing recipient address", 400);
        if (!faucetEndpoint()) return text("faucet unavailable", 503);
        return json(await handleLiveFaucet(to, req.headers));
      } catch (e) {
        if (e instanceof FaucetError) {
          return json({ ok: false, kind: e.kind, message: e.message }, faucetHttpStatus(e.kind));
        }
        return text(e instanceof Error ? e.message : "faucet failed", 400);
      }
    }
    if (name === "prepare") {
      try {
        const from = q.get("from") ?? "";
        const to = q.get("to") ?? "";
        const amount = Number(q.get("amount") ?? "0");
        if (!amount || amount <= 0) return text("amount required", 400);

        const fromHex = parseAddr(from);
        const toHex = parseAddr(to);
        if (!fromHex) return text("invalid sender address", 400);
        if (!toHex) return text("invalid recipient address", 400);

        const fromCanonical = toCanonicalAddress(fromHex)!;
        const balHex = await callRpc("kovanica_getBalance", [fromCanonical]);
        const balance = parseInt(balHex, 16);
        const fee = 10_000;
        if (balance < amount + fee) {
          return text(`Insufficient balance: available ${balance / 1e9} KVNC, need ${(amount + fee) / 1e9} KVNC`, 400);
        }

        const nonceHex = await callRpc("kovanica_getNonce", [fromCanonical]);
        const nonce = BigInt(nonceHex || "0x0");

        const fromBytes = hexToBytes(fromHex);
        const toBytes = hexToBytes(toHex);
        const hash = signingHash(fromBytes, nonce, toBytes, amount, fee, 2);
        const sighashHex = bytesToHex(hash);

        return json({
          ok: true,
          sighash: sighashHex,
          value: amount,
          fee,
          change: 0,
          outpoint: { tx: sighashHex, index: 0 },
        });
      } catch (e) {
        return text(e instanceof Error ? e.message : "prepare failed", 400);
      }
    }
    if (name === "submit_tx") {
      if (method !== "POST") return text("method not allowed", 405);
      let body: { tx_hex?: unknown };
      try {
        body = (await req.json()) as { tx_hex?: unknown };
      } catch {
        return text("invalid JSON body", 400);
      }
      const raw = typeof body?.tx_hex === "string" ? body.tx_hex.trim() : "";
      const cleanHex = raw.replace(/^0x/i, "").toLowerCase();
      if (!cleanHex || cleanHex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(cleanHex)) {
        return text("invalid tx_hex: expected non-empty even-length hex", 400);
      }
      try {
        const txHash = await callRpc("kovanica_sendRawTransaction", [cleanHex]);
        return json({ ok: true, tx: txHash });
      } catch (e) {
        if (e instanceof RpcError && e.status === 401) {
          return text("writes are not available via the public RPC", 403);
        }
        if (e instanceof RpcError && (e.status === 502 || e.status === 503 || e.status === null)) {
          return text(`testnet node error: ${e.message}`, rpcFailureStatus(e));
        }
        return text(e instanceof Error ? e.message : "submit_tx failed", 400);
      }
    }
    if (name === "submit") {
      try {
        const from = q.get("from") ?? "";
        const to = q.get("to") ?? "";
        const amount = Number(q.get("amount") ?? "0");
        let sig = q.get("sig") ?? "";

        if (!sig && method === "POST") {
          try {
            const body = await req.json();
            sig = body.sig || body.signature || "";
          } catch {}
        }
        if (!sig) return text("missing signature", 400);

        const fromHex = parseAddr(from);
        const toHex = parseAddr(to);
        if (!fromHex || !toHex) return text("invalid addresses", 400);

        const fromCanonical = toCanonicalAddress(fromHex)!;
        const nonceHex = await callRpc("kovanica_getNonce", [fromCanonical]);
        const nonce = BigInt(nonceHex || "0x0");
        const fee = 10_000;

        const fromBytes = hexToBytes(fromHex);
        const toBytes = hexToBytes(toHex);
        const hash = signingHash(fromBytes, nonce, toBytes, amount, fee, 2);
        const sigBytes = hexToBytes(sig);

        const rawHex = encodeRawTransaction(fromBytes, nonce, toBytes, amount, fee, sigBytes, hash);
        const txHash = await callRpc("kovanica_sendRawTransaction", [rawHex]);
        return json({ ok: true, tx: txHash });
      } catch (e) {
        if (e instanceof RpcError && e.status === 401) {
          return text("writes are not available via the public RPC", 403);
        }
        return text(e instanceof Error ? e.message : "submit failed", 400);
      }
    }
  }

  // Local mock fallback for local testing
  if (name === "rwa" && url.pathname.replace(/^\/api\/rwa\/?/, "").replace(/\/$/, "") === "derive") {
    return handleRwaDerive(req, q, method);
  }
  if (name === "supply" && method !== "GET") {
    return text("method not allowed", 405);
  }

  if (method === "GET") {
    switch (name) {
      case "head":
        return json(localHead());
      case "bootstrap":
        return json(localBootstrap({ ok: false, error: "local source" }));
      case "supply": {
        const node = localState().node;
        return json({
          network: NETWORK_ID,
          token: TOKEN,
          decimals: DECIMALS,
          atom: ATOM,
          blocks: node.blocks,
          max_supply: MAX_SUPPLY,
          founder_amount: FOUNDER_AMOUNT,
          treasury_total: 8_000_000 * ATOM,
          mining_subsidy_budget: 82_000_000 * ATOM,
          subsidy: SUBSIDY,
          halving_era: HALVING_ERA,
          circulating: node.supply,
          burned: 0,
          native_minted: node.issuance,
          source: "local",
        });
      }
      case "state":
        return json(localState());
      case "utxos":
        return json(localUtxos(q.get("address") ?? ""));
      case "history":
        return json(localHistory(q.get("address") ?? ""));
      case "origins":
        return json(localOrigins());
      case "p2p":
        return json(localP2p());
      case "blocks":
        return withCors(
          new Response(localBlocksDump(), {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
        );
      default:
        return text("not found", 404);
    }
  }

  if (method === "POST") {
    switch (name) {
      case "prepare":
        return json(localPrepare(q.get("from"), q.get("to"), q.get("amount")));
      case "submit":
        return json(localSubmit(q.get("from"), q.get("to"), q.get("amount"), q.get("sig")));
      case "produce":
        return json(localProduce());
      case "mine":
        return json(localMine());
      case "mining":
        return json(localMining(q.get("on")));
      case "miner":
        return json(localMiner(q.get("addr")));
      case "faucet":
        return json(localFaucet(q.get("to"), q.get("amount"), q.get("kind")));
      case "fee_estimate":
        return json(localFeeEstimate(q.get("amount")));
      case "reset":
        return json(localReset());
      case "origin":
        return json(localOrigin(q.get("iso3")));
      case "contract_call": {
        let body: Partial<Record<keyof ContractCallRequest, unknown>>;
        try {
          body = (await req.json()) as Partial<Record<keyof ContractCallRequest, unknown>>;
        } catch {
          return text("invalid JSON body", 400);
        }
        const res = localContractCall(body);
        if (typeof res === "string") return text(res, 400);
        return json(res);
      }
      case "contract_storage": {
        let body: Partial<Record<string, unknown>>;
        try {
          body = (await req.json()) as Partial<Record<string, unknown>>;
        } catch {
          return text("invalid JSON body", 400);
        }
        const res = localContractStorage(body);
        if (typeof res === "string") return text(res, 400);
        return json(res);
      }
      case "contract_receipt": {
        let body: Partial<Record<string, unknown>>;
        try {
          body = (await req.json()) as Partial<Record<string, unknown>>;
        } catch {
          return text("invalid JSON body", 400);
        }
        const res = localContractReceipt(body);
        if (typeof res === "string") return text(res, 400);
        return json(res);
      }
      default:
        return text("unknown action " + name, 400);
    }
  }

  return text("method not allowed", 405);
}
