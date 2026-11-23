import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTimelineInspectorUrl,
  filterTimelineEntries,
  normalizeTimelineLogs,
  type ContractTimelineEntry,
} from "../src/lib/explorer/log-timeline";
import {
  concatBytes,
  encodeBincodeString,
  encodeBincodeStringVec,
  u128le,
} from "../src/lib/contracts/decoders";
import { hexToKvnc } from "../src/lib/wallet/address";

const VALID_TX_A = `0x${"aa".repeat(32)}`;
const VALID_TX_B = `0x${"bb".repeat(32)}`;
const VALID_TX_C = "CC".repeat(32); // valid 32-byte hex without 0x prefix, uppercase
const SAMPLE_CONTRACT_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";
const SAMPLE_CONTRACT_KVNC = hexToKvnc(SAMPLE_CONTRACT_HEX);

function toHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("buildTimelineInspectorUrl", () => {
  it("generates a canonical /explorer?tab=contracts&tx=<hash> URL for valid 32-byte hashes", () => {
    assert.equal(
      buildTimelineInspectorUrl(VALID_TX_A),
      `/explorer?tab=contracts&tx=${VALID_TX_A}`,
    );
    assert.equal(
      buildTimelineInspectorUrl(VALID_TX_C),
      `/explorer?tab=contracts&tx=0x${"cc".repeat(32)}`,
    );
  });

  it("rejects XSS payloads, query injection, and malformed hashes", () => {
    const hostileInputs: unknown[] = [
      "javascript:alert(1)",
      "<script>alert(1)</script>",
      `${VALID_TX_A}&evil=1`,
      `0x${"aa".repeat(31)}`, // 31 bytes (too short)
      `0x${"aa".repeat(33)}`, // 33 bytes (too long)
      `0x${"gg".repeat(32)}`, // non-hex
      "../explorer?tab=contracts",
      "",
      "   ",
      null,
      undefined,
      12345,
    ];

    for (const input of hostileInputs) {
      assert.equal(buildTimelineInspectorUrl(input), undefined);
    }
  });
});

describe("normalizeTimelineLogs", () => {
  it("sorts newest-first by blockNumber desc, then logIndex desc", () => {
    const entries = normalizeTimelineLogs([
      {
        transactionHash: VALID_TX_A,
        blockNumber: "0x10", // 16
        logIndex: "0x1",
        address: SAMPLE_CONTRACT_HEX,
        topics: ["transfer"],
        data: "0x",
      },
      {
        transactionHash: VALID_TX_B,
        blockNumber: 20,
        logIndex: 0,
        address: SAMPLE_CONTRACT_KVNC,
        topics: ["mint"],
        data: "0x",
      },
      {
        transactionHash: VALID_TX_C,
        blockNumber: "0x14", // 20
        logIndex: "0x3",
        address: SAMPLE_CONTRACT_KVNC,
        topics: ["burn"],
        data: "0x",
      },
      {
        transactionHash: VALID_TX_A,
        blockNumber: 16,
        logIndex: 5,
        address: SAMPLE_CONTRACT_KVNC,
        topics: ["approval"],
        data: "0x",
      },
    ]);

    assert.equal(entries.length, 4);
    assert.deepEqual(
      entries.map((e) => [e.blockNumber, e.logIndex, e.topics[0]]),
      [
        [20, 3, "burn"],
        [20, 0, "mint"],
        [16, 5, "approval"],
        [16, 1, "transfer"],
      ],
    );
    assert.equal(entries[0]?.txHash, `0x${"cc".repeat(32)}`);
    assert.equal(
      entries[0]?.inspectorUrl,
      `/explorer?tab=contracts&tx=0x${"cc".repeat(32)}`,
    );
    assert.equal(entries[3]?.address, SAMPLE_CONTRACT_KVNC);
  });

  it("decodes Bincode payloads when a matching schema/decoder is present", () => {
    const ownerBytes = new Uint8Array(32).fill(0x22);
    const pubkeyBytes = new Uint8Array(32).fill(0x33);
    const nameEntryBytes = concatBytes([
      ownerBytes,
      pubkeyBytes,
      encodeBincodeStringVec(["wss://relay.kovanica.online"]),
    ]);

    const tokenMetaBytes = concatBytes([
      encodeBincodeString("Kovanica Gold"),
      encodeBincodeString("KVG"),
      Uint8Array.of(9),
      u128le(1_000_000_000_000n),
      ownerBytes,
    ]);

    const entries = normalizeTimelineLogs([
      {
        txHash: VALID_TX_A,
        blockNumber: 100,
        logIndex: 0,
        address: SAMPLE_CONTRACT_KVNC,
        topics: ["name_register"],
        data: toHex(nameEntryBytes),
      },
      {
        txHash: VALID_TX_B,
        blockNumber: 101,
        logIndex: 0,
        address: SAMPLE_CONTRACT_KVNC,
        topics: ["token_created"],
        data: toHex(tokenMetaBytes),
      },
      {
        txHash: VALID_TX_A,
        blockNumber: 99,
        logIndex: 0,
        address: SAMPLE_CONTRACT_KVNC,
        topics: ["custom_binary"],
        // 3 bytes of arbitrary non-UTF8 binary — should fall back to raw hex (no decodedSummary)
        data: "0xfffe01",
      },
    ]);

    assert.equal(entries.length, 3);

    // Block 101: TokenMetadata
    assert.equal(entries[0]?.decodedKind, "token_meta");
    assert.ok(entries[0]?.decodedSummary?.includes("Kovanica Gold"));
    assert.ok(entries[0]?.decodedSummary?.includes("KVG"));

    // Block 100: NameEntry
    assert.equal(entries[1]?.decodedKind, "name_entry");
    assert.ok(entries[1]?.decodedSummary?.includes("wss://relay.kovanica.online"));

    // Block 99: Unrecognized raw binary falls back cleanly
    assert.equal(entries[2]?.decodedKind, undefined);
    assert.equal(entries[2]?.decodedSummary, undefined);
    assert.equal(entries[2]?.data, "0xfffe01");
  });

  it("rejects XSS and malformed tx hashes without throwing or emitting unsafe inspectorUrl", () => {
    const entries = normalizeTimelineLogs([
      {
        transactionHash: "javascript:alert(1)",
        blockNumber: 50,
        logIndex: 0,
        address: SAMPLE_CONTRACT_KVNC,
        topics: ["suspicious_event"],
        data: "0x",
      },
      {
        transactionHash: "<img src=x onerror=alert(1)>",
        blockNumber: 49,
        logIndex: 0,
        address: SAMPLE_CONTRACT_KVNC,
        topics: ["another_event"],
        data: "0x",
      },
    ]);

    assert.equal(entries.length, 2);
    for (const entry of entries) {
      assert.equal(entry.txHash, "");
      assert.equal(entry.inspectorUrl, undefined);
    }
  });

  it("handles empty, null, non-array, and malformed log payloads gracefully", () => {
    assert.deepEqual(normalizeTimelineLogs(null), []);
    assert.deepEqual(normalizeTimelineLogs(undefined), []);
    assert.deepEqual(normalizeTimelineLogs("not-an-array"), []);
    assert.deepEqual(normalizeTimelineLogs({}), []);
    assert.deepEqual(normalizeTimelineLogs([]), []);

    const entries = normalizeTimelineLogs([
      null,
      undefined,
      42,
      "bad",
      [],
      {}, // completely empty object skipped
      {
        tx_hash: VALID_TX_A,
        block_number: "not-a-number",
        log_index: -5,
        topics: [123, "", "  valid_topic  ", null],
        data: "not-valid-hex!!!",
      },
    ]);

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.txHash, VALID_TX_A);
    assert.equal(entries[0]?.blockNumber, 0);
    assert.equal(entries[0]?.logIndex, 0);
    assert.deepEqual(entries[0]?.topics, ["valid_topic"]);
    assert.equal(entries[0]?.data, "0x");
    assert.equal(entries[0]?.inspectorUrl, `/explorer?tab=contracts&tx=${VALID_TX_A}`);
  });

  it("applies optional query filter and limit", () => {
    const raw = [
      { transactionHash: VALID_TX_A, blockNumber: 3, logIndex: 0, topics: ["token_transfer"] },
      { transactionHash: VALID_TX_B, blockNumber: 2, logIndex: 0, topics: ["token_mint"] },
      { transactionHash: VALID_TX_A, blockNumber: 1, logIndex: 0, topics: ["token_transfer"] },
    ];

    const filtered = normalizeTimelineLogs(raw, { query: "transfer", limit: 1 });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.blockNumber, 3);
  });
});

describe("filterTimelineEntries", () => {
  const sampleEntries: ContractTimelineEntry[] = [
    {
      txHash: VALID_TX_A,
      blockNumber: 120,
      logIndex: 1,
      address: SAMPLE_CONTRACT_KVNC,
      topics: ["token_created", "kvp102"],
      data: "0x1234",
      decodedKind: "token_meta",
      decodedSummary: "TokenMetadata · Kovanica Gold (KVG)",
      inspectorUrl: `/explorer?tab=contracts&tx=${VALID_TX_A}`,
    },
    {
      txHash: VALID_TX_B,
      blockNumber: 118,
      logIndex: 0,
      address: SAMPLE_CONTRACT_KVNC,
      topics: ["escrow_settled"],
      data: "0xabcd",
      decodedKind: "escrow",
      decodedSummary: "Escrow · 2 of 3 parties",
      inspectorUrl: `/explorer?tab=contracts&tx=${VALID_TX_B}`,
    },
  ];

  it("returns all entries for empty or whitespace queries", () => {
    assert.equal(filterTimelineEntries(sampleEntries, "").length, 2);
    assert.equal(filterTimelineEntries(sampleEntries, "   ").length, 2);
    assert.equal(filterTimelineEntries(sampleEntries, null).length, 2);
    assert.equal(filterTimelineEntries(sampleEntries, undefined).length, 2);
  });

  it("filters case-insensitively by topic, decoded summary, block number, and tx hash", () => {
    assert.equal(filterTimelineEntries(sampleEntries, "TOKEN_CREATED").length, 1);
    assert.equal(filterTimelineEntries(sampleEntries, "kovanica gold").length, 1);
    assert.equal(filterTimelineEntries(sampleEntries, "118").length, 1);
    assert.equal(filterTimelineEntries(sampleEntries, "bbbbbb").length, 1);
    assert.equal(filterTimelineEntries(sampleEntries, "escrow parties").length, 1);
    assert.equal(filterTimelineEntries(sampleEntries, "nonexistent_topic").length, 0);
  });
});
