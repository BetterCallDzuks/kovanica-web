import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutBlocksHorizontal } from "../src/components/explorer/dag-canvas";
import type { Block } from "../src/lib/ledger/types";

function makeBlock(partial: Partial<Block> & Pick<Block, "id" | "height" | "colour">): Block {
  return {
    parents: [],
    selectedParent: null,
    work: partial.height * 10,
    timestamp: 1_700_000_000_000 + partial.height * 4000,
    nonce: 1,
    blueScore: partial.height,
    txs: [],
    ...partial,
  };
}

test("layoutBlocksHorizontal orders blocks left-to-right with multi-lane parallel/fork separation", () => {
  const blocks: Block[] = [
    makeBlock({ id: "0x0000", height: 0, colour: "genesis" }),
    makeBlock({
      id: "0x0001a",
      height: 1,
      colour: "chain",
      parents: ["0x0000"],
      selectedParent: "0x0000",
    }),
    makeBlock({
      id: "0x0001b",
      height: 1,
      colour: "blue",
      parents: ["0x0000"],
      selectedParent: "0x0000",
    }),
    makeBlock({
      id: "0x0001r",
      height: 1,
      colour: "red",
      parents: ["0x0000"],
      selectedParent: "0x0000",
    }),
    makeBlock({
      id: "0x0002",
      height: 2,
      colour: "chain",
      parents: ["0x0001a", "0x0001b"],
      selectedParent: "0x0001a",
    }),
  ];

  const layout = layoutBlocksHorizontal(blocks, 900, 420, "0x0002");
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));

  const g = byId.get("0x0000")!;
  const c1 = byId.get("0x0001a")!;
  const b1 = byId.get("0x0001b")!;
  const r1 = byId.get("0x0001r")!;
  const tip = byId.get("0x0002")!;

  // Left-to-right chronological order
  assert.ok(g.x < c1.x && c1.x < tip.x, "Blocks must progress strictly left-to-right by height");
  assert.equal(c1.x, b1.x, "Parallel blocks at the same height share the same X column");
  assert.equal(c1.x, r1.x, "Fork blocks at the same height share the same X column");

  // Multi-lane separation (not a flat straight line)
  assert.equal(g.lane, 0);
  assert.equal(c1.lane, 0);
  assert.equal(tip.lane, 0);
  assert.notEqual(b1.lane, 0, "Parallel blue block must sit off the main chain center lane");
  assert.notEqual(r1.lane, 0, "Fork red block must sit off the main chain center lane");
  assert.notEqual(b1.lane, r1.lane, "Parallel blue and fork red blocks at same height must not overlap");

  // Only the active tip gets role='tip'
  assert.equal(g.role, "genesis");
  assert.equal(c1.role, "chain");
  assert.equal(b1.role, "blue");
  assert.equal(r1.role, "red");
  assert.equal(tip.role, "tip");

  // Edge classification
  const edgeByKey = new Map(layout.edges.map((e) => [e.key, e]));
  assert.equal(edgeByKey.get("0x0001a->0x0002")?.kind, "backbone");
  assert.equal(edgeByKey.get("0x0001b->0x0002")?.kind, "merge");
  assert.equal(edgeByKey.get("0x0000->0x0001r")?.kind, "fork");
});
