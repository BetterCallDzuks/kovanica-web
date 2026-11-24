import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearLiveDagCache,
  fetchLiveDagBlocks,
  normalizeRawRpcBlock,
  parseRpcNumber,
  type RawRpcBlock,
} from "../src/lib/api/live-dag.server";

describe("live-dag.server", () => {
  beforeEach(() => {
    clearLiveDagCache();
  });

  it("parses hex and decimal RPC quantities", () => {
    assert.equal(parseRpcNumber("0x1a7a2"), 108450);
    assert.equal(parseRpcNumber(108450), 108450);
    assert.equal(parseRpcNumber("42"), 42);
    assert.equal(parseRpcNumber(""), null);
    assert.equal(parseRpcNumber(null), null);
  });

  it("normalizes a full live RPC block with PoW proof fields", () => {
    const raw: RawRpcBlock = {
      hash: "0x9a3071a98227b1b2ce5d771a18877819a897b36bb2631562fba99edf44d7f08f",
      height: "0x1a7a2",
      nonce: 316160165,
      parent_hashes: ["0xaaa", "0xbbb"],
      pow_hash: "0x00109439e0159f745c00e3f5bc3cf1a61f3536767efbebc8e8134a67c91c0fb2",
      pow_timestamp: 1795536511758,
      state_root: "0xd808daabeef1584db6bc2b3860820f4b327c795ad19e13d3d1d399e95bbde7ef",
      target_bits: "0x1f23022c",
      timestamp: 1795536511758,
      transactions: [],
      tx_merkle_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
    };

    const block = normalizeRawRpcBlock(raw, {
      selectedChainIds: new Set([raw.hash as string]),
    });
    assert.ok(block);
    assert.equal(block.id, raw.hash);
    assert.equal(block.work, 108450);
    assert.equal(block.selected_parent, "0xaaa");
    assert.deepEqual(block.parents, ["0xaaa", "0xbbb"]);
    assert.equal(block.colour, "chain");
    assert.equal(block.nonce, 316160165);
    assert.equal(block.target_bits, "0x1f23022c");
    assert.equal(block.pow_hash, raw.pow_hash);
    assert.equal(block.state_root, raw.state_root);
    assert.equal(block.tx_merkle_root, raw.tx_merkle_root);
    assert.equal(block.pow_timestamp, 1795536511758);
  });

  it("builds a real BlockDAG from committed heights, tips, and 1-hop parents without synthesizing", async () => {
    const blocksByHeight = new Map<number, RawRpcBlock>([
      [
        10,
        {
          hash: "0xh10",
          height: "0xa",
          parent_hashes: ["0xh9"],
          nonce: 10,
          timestamp: 1000,
          transactions: [],
        },
      ],
      [
        11,
        {
          hash: "0xh11",
          height: "0xb",
          parent_hashes: ["0xh10", "0xside10"],
          nonce: 11,
          timestamp: 5000,
          transactions: [],
        },
      ],
    ]);
    const blocksByHash = new Map<string, RawRpcBlock>([
      [
        "0xtip2",
        {
          hash: "0xtip2",
          height: "0xb",
          parent_hashes: ["0xside10"],
          nonce: 12,
          timestamp: 5200,
          transactions: [],
        },
      ],
      [
        "0xside10",
        {
          hash: "0xside10",
          height: "0xa",
          parent_hashes: ["0xh9"],
          nonce: 9,
          timestamp: 1100,
          transactions: [],
        },
      ],
    ]);

    const calls: string[] = [];
    const callRpc = async <T,>(method: string, params: unknown[] = []): Promise<T> => {
      calls.push(`${method}:${String(params[0])}`);
      if (method === "kovanica_getBlockByNumber") {
        return (blocksByHeight.get(Number(params[0])) ?? null) as T;
      }
      if (method === "kovanica_getBlockByHash") {
        return (blocksByHash.get(String(params[0])) ?? null) as T;
      }
      return null as T;
    };

    const dag = await fetchLiveDagBlocks({
      committedHeight: 11,
      tips: ["0xh11", "0xtip2"],
      callRpc,
      cacheScope: "test-scope-1",
      heightWindow: 2,
    });

    assert.equal(dag.length, 4);
    assert.deepEqual(
      dag.map((b) => b.id),
      ["0xh10", "0xside10", "0xh11", "0xtip2"],
    );
    assert.equal(dag.find((b) => b.id === "0xh11")?.colour, "chain");
    assert.equal(dag.find((b) => b.id === "0xtip2")?.colour, "blue");

    // Second call should hit cache and perform zero additional RPC calls
    const callCountAfterFirst = calls.length;
    const dag2 = await fetchLiveDagBlocks({
      committedHeight: 11,
      tips: ["0xh11", "0xtip2"],
      callRpc,
      cacheScope: "test-scope-1",
      heightWindow: 2,
    });
    assert.equal(dag2.length, 4);
    assert.equal(calls.length, callCountAfterFirst);
  });

  it("returns an empty array when the upstream node returns null for all block queries", async () => {
    const dag = await fetchLiveDagBlocks({
      committedHeight: 100,
      tips: ["0xmissing"],
      callRpc: async <T,>() => null as T,
      cacheScope: "test-scope-empty",
      heightWindow: 3,
    });
    assert.deepEqual(dag, []);
  });
});
