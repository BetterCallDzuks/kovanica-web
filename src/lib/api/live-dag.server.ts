import type { ApiDagBlock, ApiTx } from "./contract";

export interface RawRpcBlock {
  hash?: unknown;
  digest?: unknown;
  height?: unknown;
  number?: unknown;
  round?: unknown;
  parents?: unknown;
  parent_hashes?: unknown;
  nonce?: unknown;
  timestamp?: unknown;
  timestamp_ms?: unknown;
  pow_timestamp?: unknown;
  powTimestamp?: unknown;
  target_bits?: unknown;
  targetBits?: unknown;
  difficulty?: unknown;
  pow_hash?: unknown;
  powHash?: unknown;
  state_root?: unknown;
  stateRoot?: unknown;
  tx_merkle_root?: unknown;
  txMerkleRoot?: unknown;
  transactions?: unknown;
  txs?: unknown;
}

export type RpcCaller = <T = unknown>(method: string, params?: unknown[]) => Promise<T>;

export interface FetchLiveDagOptions {
  committedHeight: number;
  tips: string[];
  callRpc: RpcCaller;
  /** Namespace key (e.g. RPC endpoint URL) so separate endpoints/tests never share cache entries. */
  cacheScope?: string;
  /** Number of recent committed heights to fetch (default 18). */
  heightWindow?: number;
  /** Maximum total blocks returned in the DAG snapshot (default 32). */
  maxBlocks?: number;
  /** Maximum parallel RPC calls per wave (default 8). */
  concurrency?: number;
}

const DEFAULT_HEIGHT_WINDOW = 18;
const DEFAULT_MAX_BLOCKS = 32;
const DEFAULT_CONCURRENCY = 8;
const MAX_CACHE_ENTRIES = 256;

const blockCache = new Map<string, RawRpcBlock>();

function cacheGet(key: string): RawRpcBlock | undefined {
  const hit = blockCache.get(key);
  if (!hit) return undefined;
  // Refresh LRU order
  blockCache.delete(key);
  blockCache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: RawRpcBlock): void {
  if (blockCache.has(key)) {
    blockCache.delete(key);
  } else if (blockCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = blockCache.keys().next().value;
    if (oldest !== undefined) blockCache.delete(oldest);
  }
  blockCache.set(key, value);
}

export function clearLiveDagCache(): void {
  blockCache.clear();
}

export function parseRpcNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = /^0x[0-9a-f]+$/i.test(trimmed) ? Number.parseInt(trimmed, 16) : Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractParentHashes(raw: RawRpcBlock): string[] {
  const source = Array.isArray(raw.parent_hashes)
    ? raw.parent_hashes
    : Array.isArray(raw.parents)
      ? raw.parents
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of source) {
    if (typeof item === "string") {
      const h = item.trim();
      if (h && !seen.has(h)) {
        seen.add(h);
        out.push(h);
      }
    }
  }
  return out;
}

function mapRawTransactions(raw: RawRpcBlock): ApiTx[] {
  const list = Array.isArray(raw.transactions)
    ? raw.transactions
    : Array.isArray(raw.txs)
      ? raw.txs
      : [];
  const out: ApiTx[] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim().length > 0) {
      out.push({
        id: item.trim(),
        coinbase: false,
        inputs: 1,
        outputs: [],
      });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const tx = item as Record<string, unknown>;
    const id = stringOrNull(tx.hash) ?? stringOrNull(tx.id) ?? stringOrNull(tx.tx_hash);
    if (!id) continue;
    const amount = parseRpcNumber(tx.amount ?? tx.value) ?? 0;
    const to = stringOrNull(tx.to ?? tx.recipient);
    const coinbase = Boolean(tx.coinbase);
    out.push({
      id,
      coinbase,
      inputs: coinbase ? 0 : 1,
      outputs: to ? [{ value: amount, owner: to }] : [],
      ...(typeof tx.type === "string" ? { type: tx.type } : {}),
      ...(typeof tx.contract === "string" ? { contract: tx.contract } : {}),
      ...(typeof tx.method === "string" ? { method: tx.method } : {}),
      ...(typeof tx.raw === "string" ? { raw: tx.raw } : {}),
    });
  }
  return out;
}

export function normalizeRawRpcBlock(
  raw: RawRpcBlock,
  options: {
    fallbackHeight?: number;
    selectedChainIds?: ReadonlySet<string>;
    tipIds?: ReadonlySet<string>;
  } = {},
): ApiDagBlock | null {
  const id = stringOrNull(raw.hash) ?? stringOrNull(raw.digest);
  if (!id) return null;

  const parents = extractParentHashes(raw);
  const height =
    parseRpcNumber(raw.height) ??
    parseRpcNumber(raw.number) ??
    options.fallbackHeight ??
    parseRpcNumber(raw.round) ??
    0;
  const timestampMs =
    parseRpcNumber(raw.timestamp_ms) ??
    parseRpcNumber(raw.timestamp) ??
    parseRpcNumber(raw.pow_timestamp) ??
    parseRpcNumber(raw.powTimestamp) ??
    0;
  const nonce = parseRpcNumber(raw.nonce) ?? 0;
  const targetBits =
    typeof raw.target_bits === "number" || typeof raw.target_bits === "string"
      ? raw.target_bits
      : typeof raw.targetBits === "number" || typeof raw.targetBits === "string"
        ? raw.targetBits
        : undefined;
  const difficulty =
    typeof raw.difficulty === "number" || typeof raw.difficulty === "string"
      ? raw.difficulty
      : undefined;
  const powHash = stringOrNull(raw.pow_hash) ?? stringOrNull(raw.powHash) ?? undefined;
  const stateRoot = stringOrNull(raw.state_root) ?? stringOrNull(raw.stateRoot) ?? undefined;
  const txMerkleRoot =
    stringOrNull(raw.tx_merkle_root) ?? stringOrNull(raw.txMerkleRoot) ?? undefined;
  const powTimestamp =
    parseRpcNumber(raw.pow_timestamp) ?? parseRpcNumber(raw.powTimestamp) ?? undefined;

  let colour: ApiDagBlock["colour"] = "blue";
  if (height === 0) {
    colour = "genesis";
  } else if (options.selectedChainIds?.has(id) || options.tipIds?.has(id)) {
    colour = "chain";
  }

  return {
    id,
    parents,
    selected_parent: parents[0] ?? null,
    work: height,
    timestamp_ms: timestampMs,
    nonce,
    blue_score: height,
    colour,
    txs: mapRawTransactions(raw),
    ...(targetBits !== undefined ? { target_bits: targetBits } : {}),
    ...(difficulty !== undefined ? { difficulty } : {}),
    ...(powHash !== undefined ? { pow_hash: powHash } : {}),
    ...(stateRoot !== undefined ? { state_root: stateRoot } : {}),
    ...(txMerkleRoot !== undefined ? { tx_merkle_root: txMerkleRoot } : {}),
    ...(powTimestamp !== undefined ? { pow_timestamp: powTimestamp } : {}),
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const idx = nextIndex;
        nextIndex += 1;
        results[idx] = await fn(items[idx]);
      }
    }),
  );

  return results;
}

/**
 * Fetch a recent bounded window of real BlockDAG blocks from the upstream node
 * via `kovanica_getBlockByNumber` (recent committed heights) and
 * `kovanica_getBlockByHash` (live DAG tips + 1-hop parents).
 *
 * Never synthesizes fake blocks: if the node returns null/errors for every
 * block lookup, returns `[]`.
 */
export async function fetchLiveDagBlocks(options: FetchLiveDagOptions): Promise<ApiDagBlock[]> {
  const heightWindow = Math.max(1, Math.min(options.heightWindow ?? DEFAULT_HEIGHT_WINDOW, 32));
  const maxBlocks = Math.max(1, Math.min(options.maxBlocks ?? DEFAULT_MAX_BLOCKS, 64));
  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, 12));
  const scope = options.cacheScope ?? "default";

  const committedHeight =
    Number.isFinite(options.committedHeight) && options.committedHeight >= 0
      ? Math.floor(options.committedHeight)
      : 0;
  const tips = options.tips.filter((t) => typeof t === "string" && t.trim().length > 0);

  const byHash = new Map<string, { raw: RawRpcBlock; fallbackHeight?: number }>();
  const committedIds = new Set<string>();

  const fetchByHeight = async (h: number): Promise<void> => {
    const key = `${scope}:h:${h}`;
    let raw = cacheGet(key);
    if (!raw) {
      const fetched = await options
        .callRpc<RawRpcBlock | null>("kovanica_getBlockByNumber", [h])
        .catch(() => null);
      if (fetched && typeof fetched === "object") {
        raw = fetched;
        cacheSet(key, raw);
        const hash = stringOrNull(raw.hash) ?? stringOrNull(raw.digest);
        if (hash) cacheSet(`${scope}:id:${hash}`, raw);
      }
    }
    if (!raw) return;
    const id = stringOrNull(raw.hash) ?? stringOrNull(raw.digest);
    if (!id) return;
    committedIds.add(id);
    if (!byHash.has(id)) {
      byHash.set(id, { raw, fallbackHeight: h });
    }
  };

  const fetchByHash = async (hash: string): Promise<void> => {
    if (byHash.has(hash) || byHash.size >= maxBlocks) return;
    const key = `${scope}:id:${hash}`;
    let raw = cacheGet(key);
    if (!raw) {
      const fetched = await options
        .callRpc<RawRpcBlock | null>("kovanica_getBlockByHash", [hash])
        .catch(() => null);
      if (fetched && typeof fetched === "object") {
        raw = fetched;
        cacheSet(key, raw);
      }
    }
    if (!raw) return;
    const id = stringOrNull(raw.hash) ?? stringOrNull(raw.digest) ?? hash;
    if (!byHash.has(id)) {
      byHash.set(id, { raw });
    }
  };

  // Wave 1: recent committed heights (descending from committedHeight) + live DAG tips
  const heights: number[] = [];
  if (committedHeight > 0) {
    const start = Math.max(0, committedHeight - heightWindow + 1);
    for (let h = committedHeight; h >= start; h -= 1) {
      heights.push(h);
    }
  } else if (tips.length === 0) {
    heights.push(0);
  }

  await Promise.all([
    mapWithConcurrency(heights, concurrency, fetchByHeight),
    mapWithConcurrency(tips.slice(0, 8), concurrency, fetchByHash),
  ]);

  // Wave 2: fetch 1-hop missing parents of live DAG tips so parallel GHOSTDAG branches connect
  if (byHash.size > 0 && byHash.size < maxBlocks) {
    const missingParents: string[] = [];
    const seenParent = new Set<string>();
    for (const tipHash of tips) {
      const tipEntry = byHash.get(tipHash);
      if (!tipEntry) continue;
      for (const parent of extractParentHashes(tipEntry.raw)) {
        if (!byHash.has(parent) && !seenParent.has(parent)) {
          seenParent.add(parent);
          missingParents.push(parent);
        }
      }
    }
    const remainingBudget = Math.max(0, maxBlocks - byHash.size);
    if (missingParents.length > 0 && remainingBudget > 0) {
      await mapWithConcurrency(
        missingParents.slice(0, remainingBudget),
        concurrency,
        fetchByHash,
      );
    }
  }

  if (byHash.size === 0) return [];

  const selectedTipSet = new Set<string>(tips[0] ? [tips[0]] : []);
  const blocks: ApiDagBlock[] = [];
  for (const { raw, fallbackHeight } of byHash.values()) {
    const normalized = normalizeRawRpcBlock(raw, {
      fallbackHeight,
      selectedChainIds: committedIds,
      tipIds: selectedTipSet,
    });
    if (normalized) blocks.push(normalized);
  }

  blocks.sort((a, b) => a.work - b.work || a.id.localeCompare(b.id));
  return blocks.slice(-maxBlocks);
}
