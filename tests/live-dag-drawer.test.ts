import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LIVE_FEED_ENTRIES,
  extractLiveDagFeed,
  summarizeMempoolStream,
  type LiveDagFeedEntry,
  type LiveFeedDagBlockLike,
  type LiveFeedStateLike,
} from "../src/lib/explorer/live-feed";

function makeBlock(
  overrides: Partial<LiveFeedDagBlockLike> & { id: string },
): LiveFeedDagBlockLike {
  return {
    parents: [],
    selected_parent: null,
    work: 1,
    timestamp_ms: 1_700_000_000_000,
    blue_score: 1,
    colour: "blue",
    txs: [],
    ...overrides,
  };
}

test("extractLiveDagFeed handles null, undefined, and partial empty states safely", () => {
  assert.deepEqual(extractLiveDagFeed(null), []);
  assert.deepEqual(extractLiveDagFeed(undefined), []);
  assert.deepEqual(extractLiveDagFeed({}), []);
  assert.deepEqual(extractLiveDagFeed({ node: {} }), []);
  assert.deepEqual(
    extractLiveDagFeed({ node: { dag: null, tips: null, order: null } }),
    [],
  );
});

test("extractLiveDagFeed extracts blocks sorted newest-first with tip, leader, blue/red, and tx counts", () => {
  const redParent = makeBlock({
    id: "red-parent-001",
    work: 10,
    blue_score: 9,
    colour: "red",
    timestamp_ms: 1_700_000_010_000,
    txs: [{ id: "tx-1" }],
  });
  const leaderTip = makeBlock({
    id: "leader-tip-002",
    parents: ["red-parent-001"],
    selected_parent: "red-parent-001",
    work: 12,
    blue_score: 11,
    colour: "chain",
    timestamp_ms: 1_700_000_014_000,
    txs: [{ id: "tx-2" }, { id: "tx-3" }],
  });
  const sideTip = makeBlock({
    id: "side-tip-003",
    parents: [],
    work: 11,
    blue_score: 10,
    colour: "blue",
    timestamp_ms: 1_700_000_012_000,
    txs: [],
  });

  const state: LiveFeedStateLike = {
    node: {
      blocks: 12,
      tips: ["leader-tip-002", "side-tip-003"],
      selected_tip: "leader-tip-002",
      dag: [redParent, sideTip, leaderTip],
      order: ["red-parent-001", "side-tip-003", "leader-tip-002"],
    },
  };

  const feed = extractLiveDagFeed(state);
  assert.equal(feed.length, 3);

  // Sorted newest-first by height (12 -> 11 -> 10)
  assert.deepEqual(
    feed.map((e) => e.hash),
    ["leader-tip-002", "side-tip-003", "red-parent-001"],
  );

  // Leader tip has red parent counted and is both tip & leader
  assert.deepEqual(feed[0], {
    height: 12,
    hash: "leader-tip-002",
    txCount: 2,
    blueCount: 11,
    redCount: 1,
    timestampMs: 1_700_000_014_000,
    isTip: true,
    isLeader: true,
  });

  // Side tip is a tip but not a leader
  assert.equal(feed[1].isTip, true);
  assert.equal(feed[1].isLeader, false);
  assert.equal(feed[1].blueCount, 10);
  assert.equal(feed[1].redCount, 0);

  // Red block has redCount >= 1 and is neither tip nor leader
  assert.equal(feed[2].isTip, false);
  assert.equal(feed[2].isLeader, false);
  assert.equal(feed[2].redCount, 1);
  assert.equal(feed[2].txCount, 1);
});

test("extractLiveDagFeed deduplicates across snapshots and refreshes tip flags", () => {
  const snapshot1: LiveFeedStateLike = {
    node: {
      blocks: 5,
      tips: ["blk-5"],
      selected_tip: "blk-5",
      dag: [
        makeBlock({ id: "blk-4", work: 4, colour: "chain", timestamp_ms: 1000 }),
        makeBlock({ id: "blk-5", work: 5, colour: "chain", timestamp_ms: 2000, txs: [{}] }),
      ],
    },
  };

  const feed1 = extractLiveDagFeed(snapshot1);
  assert.equal(feed1.length, 2);
  assert.equal(feed1[0].hash, "blk-5");
  assert.equal(feed1[0].isTip, true);

  // Next snapshot advances tip to blk-6 and repeats blk-5 with updated txCount
  const snapshot2: LiveFeedStateLike = {
    node: {
      blocks: 6,
      tips: ["blk-6"],
      selected_tip: "blk-6",
      dag: [
        makeBlock({
          id: "blk-5",
          work: 5,
          colour: "chain",
          timestamp_ms: 2000,
          txs: [{}, {}],
        }),
        makeBlock({ id: "blk-6", work: 6, colour: "chain", timestamp_ms: 3000 }),
      ],
    },
  };

  const feed2 = extractLiveDagFeed(snapshot2, feed1);
  assert.equal(feed2.length, 3);
  assert.deepEqual(
    feed2.map((e) => e.hash),
    ["blk-6", "blk-5", "blk-4"],
  );
  assert.equal(feed2[0].isTip, true);
  assert.equal(feed2[0].isLeader, true);
  // blk-5 is no longer a tip and reflects the updated txCount without duplication
  assert.equal(feed2[1].isTip, false);
  assert.equal(feed2[1].txCount, 2);
});

test("extractLiveDagFeed enforces MAX_LIVE_FEED_ENTRIES (20) cap keeping newest blocks", () => {
  assert.equal(MAX_LIVE_FEED_ENTRIES, 20);

  const initialBlocks: LiveFeedDagBlockLike[] = [];
  for (let i = 1; i <= 25; i += 1) {
    initialBlocks.push(
      makeBlock({
        id: `blk-${String(i).padStart(2, "0")}`,
        work: i,
        blue_score: i,
        timestamp_ms: 1_700_000_000_000 + i * 4_000,
      }),
    );
  }

  const feed = extractLiveDagFeed({
    node: {
      blocks: 25,
      tips: ["blk-25"],
      selected_tip: "blk-25",
      dag: initialBlocks,
    },
  });

  assert.equal(feed.length, MAX_LIVE_FEED_ENTRIES);
  assert.equal(feed[0].height, 25);
  assert.equal(feed[feed.length - 1].height, 6);

  // Merging 5 newer blocks pushes out heights 6..10
  const newerBlocks: LiveFeedDagBlockLike[] = [];
  for (let i = 26; i <= 30; i += 1) {
    newerBlocks.push(
      makeBlock({
        id: `blk-${i}`,
        work: i,
        blue_score: i,
        timestamp_ms: 1_700_000_000_000 + i * 4_000,
      }),
    );
  }

  const merged = extractLiveDagFeed(
    {
      node: {
        blocks: 30,
        tips: ["blk-30"],
        selected_tip: "blk-30",
        dag: newerBlocks,
      },
    },
    feed,
  );

  assert.equal(merged.length, MAX_LIVE_FEED_ENTRIES);
  assert.equal(merged[0].height, 30);
  assert.equal(merged[merged.length - 1].height, 11);
});

test("extractLiveDagFeed includes tip-only hashes when dag array is empty or partial", () => {
  const feed = extractLiveDagFeed({
    node: {
      blocks: 42,
      tips: ["tip-alpha", "tip-beta", "tip-alpha"],
      selected_tip: "tip-alpha",
      dag: [],
    },
  });

  assert.equal(feed.length, 2);
  assert.equal(feed[0].hash, "tip-alpha");
  assert.equal(feed[0].height, 42);
  assert.equal(feed[0].isTip, true);
  assert.equal(feed[0].isLeader, true);

  assert.equal(feed[1].hash, "tip-beta");
  assert.equal(feed[1].height, 42);
  assert.equal(feed[1].isTip, true);
  assert.equal(feed[1].isLeader, false);
});

test("extractLiveDagFeed preserves previousEntries when next state is null", () => {
  const prev: LiveDagFeedEntry[] = [
    {
      height: 7,
      hash: "cached-7",
      txCount: 1,
      blueCount: 7,
      redCount: 0,
      timestampMs: 5000,
      isTip: true,
      isLeader: true,
    },
  ];
  const result = extractLiveDagFeed(null, prev);
  assert.deepEqual(result, prev);
});

test("summarizeMempoolStream computes pendingTxCount, tipCount, latestHeight, and transport", () => {
  // Empty / null state
  assert.deepEqual(summarizeMempoolStream(null), {
    pendingTxCount: 0,
    tipCount: 0,
    latestHeight: null,
    transport: "polling",
  });

  // Explicit mempool count + WS transport
  assert.deepEqual(
    summarizeMempoolStream(
      {
        node: {
          blocks: 128,
          mempool: 7,
          pending: ["tx1", "tx2"],
          tips: ["tip-1", "tip-2", "tip-1"],
        },
      },
      "ws",
    ),
    {
      pendingTxCount: 7,
      tipCount: 2,
      latestHeight: 128,
      transport: "ws",
    },
  );

  // Fallback to pending array length and max DAG block height when blocks/mempool are null
  assert.deepEqual(
    summarizeMempoolStream(
      {
        node: {
          blocks: null,
          mempool: null,
          pending: ["tx-a", "tx-b", "tx-c"],
          tips: ["tip-99"],
          dag: [makeBlock({ id: "blk-98", work: 98 }), makeBlock({ id: "blk-99", work: 99 })],
        },
      },
      "reconnecting",
    ),
    {
      pendingTxCount: 3,
      tipCount: 1,
      latestHeight: 99,
      transport: "reconnecting",
    },
  );

  // Paused transport
  assert.equal(summarizeMempoolStream({ node: { blocks: 10 } }, "paused").transport, "paused");
});
