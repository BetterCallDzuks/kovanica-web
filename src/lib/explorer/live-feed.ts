/**
 * Pure, dependency-free helpers for the Explorer Live DAG & Mempool Stream drawer.
 *
 * Transforms incoming `/api/state` node snapshots into a bounded, deduplicated,
 * newest-first feed of recent DAG blocks plus a concise mempool/tip summary.
 */

import type { LiveStreamTransport } from "../api/ws-stream";

export const MAX_LIVE_FEED_ENTRIES = 20;

export interface LiveDagFeedEntry {
  height: number;
  hash: string;
  txCount: number;
  blueCount: number;
  redCount: number;
  timestampMs: number;
  isTip: boolean;
  isLeader: boolean;
}

export interface MempoolStreamSummary {
  pendingTxCount: number;
  tipCount: number;
  latestHeight: number | null;
  transport: LiveStreamTransport;
}

export interface LiveFeedDagBlockLike {
  id: string;
  parents?: readonly string[] | null;
  selected_parent?: string | null;
  work?: number | null;
  height?: number | null;
  timestamp_ms?: number | null;
  blue_score?: number | null;
  colour?: "genesis" | "chain" | "blue" | "red" | string | null;
  txs?: readonly unknown[] | null;
}

export interface LiveFeedNodeLike {
  blocks?: number | null;
  tips?: readonly string[] | null;
  selected_tip?: string | null;
  mempool?: number | null;
  pending?: readonly unknown[] | null;
  dag?: readonly LiveFeedDagBlockLike[] | null;
  order?: readonly string[] | null;
}

export interface LiveFeedStateLike {
  node?: LiveFeedNodeLike | null;
}

function toNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveBlockHeight(
  block: LiveFeedDagBlockLike,
  orderIndex: ReadonlyMap<string, number>,
): number {
  const explicitHeight = toNonNegativeInt(block.height);
  if (explicitHeight !== null) return explicitHeight;

  const workHeight = toNonNegativeInt(block.work);
  if (workHeight !== null) return workHeight;

  const ordered = orderIndex.get(block.id);
  if (ordered !== undefined) return ordered;

  const blueScore = toNonNegativeInt(block.blue_score);
  if (blueScore !== null) return blueScore;

  return 0;
}

function compareFeedEntriesNewestFirst(a: LiveDagFeedEntry, b: LiveDagFeedEntry): number {
  if (b.height !== a.height) return b.height - a.height;
  if (b.timestampMs !== a.timestampMs) return b.timestampMs - a.timestampMs;
  if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1;
  if (a.isTip !== b.isTip) return a.isTip ? -1 : 1;
  return a.hash.localeCompare(b.hash);
}

/**
 * Merge recent DAG blocks and active tips from a node state snapshot with
 * previously observed feed entries.
 *
 * - Deduplicates by block hash (latest snapshot metadata wins).
 * - Refreshes `isTip` and `isLeader` flags against the latest snapshot.
 * - Sorts newest-first and bounds output to `MAX_LIVE_FEED_ENTRIES` (20).
 */
export function extractLiveDagFeed(
  state: LiveFeedStateLike | null | undefined,
  previousEntries: readonly LiveDagFeedEntry[] = [],
): LiveDagFeedEntry[] {
  const node = state?.node ?? null;
  const hasSnapshotTips = Array.isArray(node?.tips);
  const tipSet = new Set<string>();
  if (hasSnapshotTips && node?.tips) {
    for (const rawTip of node.tips) {
      const tip = normalizeHash(rawTip);
      if (tip) tipSet.add(tip);
    }
  }

  const selectedTip = normalizeHash(node?.selected_tip);
  const byHash = new Map<string, LiveDagFeedEntry>();

  for (const prev of previousEntries) {
    const hash = normalizeHash(prev.hash);
    if (!hash) continue;
    byHash.set(hash, {
      height: toNonNegativeInt(prev.height) ?? 0,
      hash,
      txCount: toNonNegativeInt(prev.txCount) ?? 0,
      blueCount: toNonNegativeInt(prev.blueCount) ?? 0,
      redCount: toNonNegativeInt(prev.redCount) ?? 0,
      timestampMs: toNonNegativeInt(prev.timestampMs) ?? 0,
      isTip: hasSnapshotTips ? tipSet.has(hash) : Boolean(prev.isTip),
      isLeader: selectedTip ? prev.isLeader || hash === selectedTip : Boolean(prev.isLeader),
    });
  }

  if (node) {
    const orderIndex = new Map<string, number>();
    if (Array.isArray(node.order)) {
      node.order.forEach((rawId, idx) => {
        const id = normalizeHash(rawId);
        if (id && !orderIndex.has(id)) {
          orderIndex.set(id, idx);
        }
      });
    }

    const dagBlocks = Array.isArray(node.dag) ? node.dag : [];
    const colourByHash = new Map<string, string>();
    for (const block of dagBlocks) {
      const hash = normalizeHash(block?.id);
      if (hash && typeof block.colour === "string") {
        colourByHash.set(hash, block.colour);
      }
    }

    for (const block of dagBlocks) {
      if (!block || typeof block !== "object") continue;
      const hash = normalizeHash(block.id);
      if (!hash) continue;

      const colour = typeof block.colour === "string" ? block.colour : "blue";
      const parents = Array.isArray(block.parents) ? block.parents : [];
      let redParents = 0;
      for (const rawParent of parents) {
        const parentHash = normalizeHash(rawParent);
        if (parentHash && colourByHash.get(parentHash) === "red") {
          redParents += 1;
        }
      }

      const explicitBlueScore = toNonNegativeInt(block.blue_score);
      const blueCount =
        explicitBlueScore !== null ? explicitBlueScore : colour === "red" ? 0 : 1;
      const redCount = redParents + (colour === "red" ? 1 : 0);

      byHash.set(hash, {
        height: resolveBlockHeight({ ...block, id: hash }, orderIndex),
        hash,
        txCount: Array.isArray(block.txs) ? block.txs.length : 0,
        blueCount,
        redCount,
        timestampMs: toNonNegativeInt(block.timestamp_ms) ?? 0,
        isTip: tipSet.has(hash),
        isLeader: hash === selectedTip || colour === "chain",
      });
    }

    const fallbackHeight = toNonNegativeInt(node.blocks) ?? 0;
    for (const tip of tipSet) {
      const existing = byHash.get(tip);
      if (existing) {
        byHash.set(tip, {
          ...existing,
          isTip: true,
          isLeader: existing.isLeader || tip === selectedTip,
        });
      } else {
        byHash.set(tip, {
          height: fallbackHeight,
          hash: tip,
          txCount: 0,
          blueCount: 0,
          redCount: 0,
          timestampMs: 0,
          isTip: true,
          isLeader: tip === selectedTip,
        });
      }
    }
  }

  return Array.from(byHash.values())
    .sort(compareFeedEntriesNewestFirst)
    .slice(0, MAX_LIVE_FEED_ENTRIES);
}

/**
 * Summarize mempool and live DAG stream metadata from a node state snapshot.
 */
export function summarizeMempoolStream(
  state: LiveFeedStateLike | null | undefined,
  transport: LiveStreamTransport = "polling",
): MempoolStreamSummary {
  const node = state?.node ?? null;

  const mempoolCount = toNonNegativeInt(node?.mempool);
  const pendingTxCount =
    mempoolCount !== null
      ? mempoolCount
      : Array.isArray(node?.pending)
        ? node.pending.length
        : 0;

  const uniqueTips = new Set<string>();
  if (Array.isArray(node?.tips)) {
    for (const rawTip of node.tips) {
      const tip = normalizeHash(rawTip);
      if (tip) uniqueTips.add(tip);
    }
  }

  let latestHeight = toNonNegativeInt(node?.blocks);
  if (latestHeight === null && Array.isArray(node?.dag) && node.dag.length > 0) {
    let maxHeight = -1;
    for (const block of node.dag) {
      const h =
        toNonNegativeInt(block?.height) ??
        toNonNegativeInt(block?.work) ??
        toNonNegativeInt(block?.blue_score);
      if (h !== null && h > maxHeight) {
        maxHeight = h;
      }
    }
    if (maxHeight >= 0) {
      latestHeight = maxHeight;
    }
  }

  return {
    pendingTxCount,
    tipCount: uniqueTips.size,
    latestHeight,
    transport,
  };
}
