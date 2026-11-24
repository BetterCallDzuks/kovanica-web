import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractBlockPowProof,
  formatPowNonce,
  formatPowSummaryBadge,
  formatPowTimestampIso,
  normalizeHexDigest,
  normalizePowTimestampMs,
} from "../src/lib/explorer/block-pow-inspector";
import { dagToBlocks } from "../src/lib/api/map-blocks";
import type { ApiDagBlock } from "../src/lib/api/contract";

test("extractBlockPowProof extracts and formats complete RPC PoW header fields", () => {
  const apiBlock: ApiDagBlock = {
    id: "0x3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29",
    parents: ["0x17e79432dfbee3adad15d7a851ff78ebafcefbc547073883489cd9cbdaae60fa"],
    selected_parent: "0x17e79432dfbee3adad15d7a851ff78ebafcefbc547073883489cd9cbdaae60fa",
    work: 12450,
    timestamp_ms: 1_760_000_000_000,
    nonce: 987654321,
    blue_score: 12450,
    colour: "chain",
    txs: [],
    target_bits: 0x1d00ffff,
    difficulty: 1.0,
    pow_hash: "AABBCCDD00112233445566778899AABBCCDD00112233445566778899AABBCCDD",
    state_root: "0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000",
    tx_merkle_root: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    pow_timestamp: 1_760_000_000,
  };

  const proof = extractBlockPowProof(null, apiBlock);
  assert.equal(proof.targetBits, 0x1d00ffff);
  assert.equal(proof.targetBitsHex, "0x1d00ffff");
  assert.ok(proof.targetHex && proof.targetHex.startsWith("0x"));
  assert.equal(proof.difficulty, 1.0);
  assert.equal(proof.difficultyFormatted, "1.00");
  assert.equal(proof.difficultySource, "reported");
  assert.equal(
    proof.powHash,
    "0xaabbccdd00112233445566778899aabbccdd00112233445566778899aabbccdd",
  );
  assert.equal(proof.powHashDisplay, proof.powHash);
  assert.equal(proof.nonce, "987654321");
  assert.equal(proof.nonceDisplay, "987,654,321");
  assert.equal(proof.nonceHex, "0x3ade68b1");
  assert.equal(
    proof.stateRoot,
    "0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000",
  );
  assert.equal(
    proof.txMerkleRoot,
    "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  );
  assert.equal(proof.powTimestampMs, 1_760_000_000_000);
  assert.equal(proof.powTimestampIso, new Date(1_760_000_000_000).toISOString());
  assert.equal(proof.powTimestampSource, "pow_timestamp");
  assert.equal(proof.hasAnyPowField, true);
  assert.equal(proof.populatedCount, 7);
  assert.equal(proof.totalFields, 7);
  assert.equal(formatPowSummaryBadge(proof), "Diff 1.00 · Nonce 987,654,321");
});

test("extractBlockPowProof derives difficulty from compact target_bits when explicit difficulty is absent", () => {
  const proof = extractBlockPowProof({
    targetBits: "0x1c00ffff",
    nonce: 42,
    timestamp: 1_760_000_004_000,
  });

  assert.equal(proof.targetBits, 0x1c00ffff);
  assert.equal(proof.targetBitsHex, "0x1c00ffff");
  assert.equal(proof.difficultySource, "derived");
  assert.ok(proof.difficulty !== null && Math.abs(proof.difficulty - 256) < 0.01);
  assert.equal(proof.difficultyFormatted, "256.00");
  assert.equal(proof.powTimestampSource, "block_timestamp");
  assert.equal(proof.powTimestampMs, 1_760_000_004_000);
});

test("extractBlockPowProof handles missing/null/empty fields safely without faking values", () => {
  const empty = extractBlockPowProof(null, null);
  assert.equal(empty.targetBits, null);
  assert.equal(empty.targetBitsHex, "n/a");
  assert.equal(empty.difficulty, null);
  assert.equal(empty.difficultyFormatted, "n/a");
  assert.equal(empty.difficultySource, "unavailable");
  assert.equal(empty.powHash, null);
  assert.equal(empty.powHashDisplay, "n/a");
  assert.equal(empty.nonce, null);
  assert.equal(empty.nonceDisplay, "n/a");
  assert.equal(empty.nonceHex, null);
  assert.equal(empty.stateRoot, null);
  assert.equal(empty.stateRootDisplay, "n/a");
  assert.equal(empty.txMerkleRoot, null);
  assert.equal(empty.txMerkleRootDisplay, "n/a");
  assert.equal(empty.powTimestampMs, null);
  assert.equal(empty.powTimestampIso, "n/a");
  assert.equal(empty.powTimestampSource, "unavailable");
  assert.equal(empty.hasAnyPowField, false);
  assert.equal(empty.populatedCount, 0);
  assert.equal(formatPowSummaryBadge(empty), "0/7 fields");
});

test("formatPowNonce supports zero (genesis), large u64 values, and hex strings", () => {
  assert.deepEqual(formatPowNonce(0), {
    nonce: "0",
    nonceDisplay: "0",
    nonceHex: "0x00000000",
  });
  assert.deepEqual(formatPowNonce(18_446_744_073_709_551_615n), {
    nonce: "18446744073709551615",
    nonceDisplay: "18,446,744,073,709,551,615",
    nonceHex: "0xffffffffffffffff",
  });
  assert.deepEqual(formatPowNonce("0x64"), {
    nonce: "100",
    nonceDisplay: "100",
    nonceHex: "0x00000064",
  });
  assert.deepEqual(formatPowNonce(-1), {
    nonce: null,
    nonceDisplay: "n/a",
    nonceHex: null,
  });
});

test("normalizeHexDigest and normalizePowTimestampMs handle edge cases cleanly", () => {
  assert.equal(normalizeHexDigest("   "), null);
  assert.equal(normalizeHexDigest(null), null);
  assert.equal(normalizeHexDigest("0XABCDEF0123456789"), "0xabcdef0123456789");
  assert.equal(normalizeHexDigest("ABCDEF0123456789"), "0xabcdef0123456789");

  assert.equal(normalizePowTimestampMs(1_760_000_000), 1_760_000_000_000);
  assert.equal(normalizePowTimestampMs(1_760_000_000_123), 1_760_000_000_123);
  assert.equal(normalizePowTimestampMs("2026-11-24T10:00:00.000Z"), 1_795_514_400_000);
  assert.equal(normalizePowTimestampMs(0), null);
  assert.equal(normalizePowTimestampMs(-500), null);
  assert.equal(formatPowTimestampIso(null), "n/a");
});

test("dagToBlocks preserves optional PoW header fields while remaining backwards-compatible", () => {
  const fullBlock: ApiDagBlock = {
    id: "0xaaa",
    parents: ["0x000"],
    selected_parent: "0x000",
    work: 10,
    timestamp_ms: 1_760_000_010_000,
    nonce: 777,
    blue_score: 10,
    colour: "chain",
    txs: [],
    target_bits: 0x1d00ffff,
    difficulty: "1.25",
    pow_hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    state_root: "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
    tx_merkle_root: "0x0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff",
    pow_timestamp: 1_760_000_010,
  };
  const legacyBlock: ApiDagBlock = {
    id: "0x000",
    parents: [],
    selected_parent: null,
    work: 0,
    timestamp_ms: 1_760_000_000_000,
    nonce: 0,
    blue_score: 0,
    colour: "genesis",
    txs: [],
  };

  const mapped = dagToBlocks([fullBlock, legacyBlock], ["0x000", "0xaaa"]);
  assert.equal(mapped.length, 2);

  assert.equal(mapped[0].targetBits, 0x1d00ffff);
  assert.equal(mapped[0].difficulty, 1.25);
  assert.equal(mapped[0].powHash, fullBlock.pow_hash);
  assert.equal(mapped[0].stateRoot, fullBlock.state_root);
  assert.equal(mapped[0].txMerkleRoot, fullBlock.tx_merkle_root);
  assert.equal(mapped[0].powTimestamp, 1_760_000_010);

  // Legacy block does not synthesize PoW fields
  assert.equal("powHash" in mapped[1], false);
  assert.equal("targetBits" in mapped[1], false);
  assert.equal("stateRoot" in mapped[1], false);
  assert.equal("txMerkleRoot" in mapped[1], false);
});
