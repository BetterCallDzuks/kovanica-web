import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeAddress } from "../src/lib/wallet/address";
import {
  ACCOUNT_HISTORY_CSV_HEADERS,
  addressesEqual,
  buildAccountHistoryFilename,
  buildAccountHistoryJsonPayload,
  classifyTxDirection,
  countAccountHistoryDirections,
  escapeCsvCell,
  filterAccountHistoryByDirection,
  neutralizeCsvFormula,
  normalizeAddressForComparison,
  serializeAccountHistoryCsv,
  serializeAccountHistoryJson,
  type AccountHistoryRecord,
} from "../src/lib/explorer/account-history-export";

const ALICE_HEX = "0000000000000000000000000000000000000000000000000000000000000001";
const BOB_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(
    hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
  );
}

const ALICE_MAINNET = encodeAddress(hexToBytes(ALICE_HEX));
const ALICE_TESTNET = `tknc${ALICE_MAINNET.slice(4)}`;
const BOB_MAINNET = encodeAddress(hexToBytes(BOB_HEX));

describe("account-history-export address normalization", () => {
  it("normalizes PRO-21 mainnet, testnet, uppercase, and 32-byte hex to the same canonical address", () => {
    assert.equal(normalizeAddressForComparison(ALICE_MAINNET), ALICE_MAINNET);
    assert.equal(normalizeAddressForComparison(ALICE_MAINNET.toUpperCase()), ALICE_MAINNET);
    assert.equal(normalizeAddressForComparison(`  ${ALICE_TESTNET}  `), ALICE_MAINNET);
    assert.equal(normalizeAddressForComparison(`0x${ALICE_HEX}`), ALICE_MAINNET);
    assert.equal(normalizeAddressForComparison(ALICE_HEX.toUpperCase()), ALICE_MAINNET);

    assert.equal(addressesEqual(ALICE_MAINNET, ALICE_TESTNET.toUpperCase()), true);
    assert.equal(addressesEqual(ALICE_MAINNET, `0x${ALICE_HEX}`), true);
    assert.equal(addressesEqual(ALICE_MAINNET, BOB_MAINNET), false);
    assert.equal(addressesEqual(ALICE_MAINNET, ""), false);
    assert.equal(addressesEqual(null, ALICE_MAINNET), false);
  });
});

describe("account-history-export direction filtering", () => {
  const sampleTxs: AccountHistoryRecord[] = [
    {
      tx: "tx-sent-parties",
      block: "blk-1",
      from: ALICE_MAINNET.toUpperCase(),
      to: BOB_MAINNET,
      delta: -500_000_000,
      kind: "transfer",
    },
    {
      tx: "tx-recv-parties",
      block: "blk-2",
      from: BOB_MAINNET,
      to: `0x${ALICE_HEX}`,
      delta: 1_250_000_000,
      kind: "transfer",
    },
    {
      tx: "tx-self",
      block: "blk-3",
      from: ALICE_TESTNET,
      to: ALICE_MAINNET,
      delta: -5_000,
      kind: "transfer",
    },
    {
      tx: "tx-api-out",
      block: "blk-4",
      kind: "out",
      delta: -2_000_000_000,
    },
    {
      tx: "tx-api-in",
      block: "blk-5",
      kind: "in",
      delta: 3_000_000_000,
    },
    {
      tx: "tx-api-coinbase",
      block: "blk-6",
      kind: "coinbase",
      delta: 2_500_000_000,
    },
  ];

  it("classifies directions accurately across explicit from/to and ApiHistoryTx kinds", () => {
    assert.equal(classifyTxDirection(sampleTxs[0]!, ALICE_MAINNET), "sent");
    assert.equal(classifyTxDirection(sampleTxs[1]!, ALICE_MAINNET), "received");
    assert.equal(classifyTxDirection(sampleTxs[2]!, ALICE_MAINNET), "self");
    assert.equal(classifyTxDirection(sampleTxs[3]!, ALICE_MAINNET), "sent");
    assert.equal(classifyTxDirection(sampleTxs[4]!, ALICE_MAINNET), "received");
    assert.equal(classifyTxDirection(sampleTxs[5]!, ALICE_MAINNET), "received");
  });

  it("filters by all, sent, and received and computes accurate counts", () => {
    const all = filterAccountHistoryByDirection(sampleTxs, ALICE_MAINNET, "all");
    const sent = filterAccountHistoryByDirection(sampleTxs, ALICE_MAINNET, "sent");
    const received = filterAccountHistoryByDirection(sampleTxs, ALICE_MAINNET, "received");

    assert.equal(all.length, 6);
    assert.deepEqual(
      sent.map((t) => t.tx),
      ["tx-sent-parties", "tx-self", "tx-api-out"],
    );
    assert.deepEqual(
      received.map((t) => t.tx),
      ["tx-recv-parties", "tx-self", "tx-api-in", "tx-api-coinbase"],
    );

    const counts = countAccountHistoryDirections(sampleTxs, ALICE_MAINNET);
    assert.deepEqual(counts, { all: 6, sent: 3, received: 4 });
  });

  it("handles empty transaction lists cleanly", () => {
    assert.deepEqual(filterAccountHistoryByDirection([], ALICE_MAINNET, "all"), []);
    assert.deepEqual(filterAccountHistoryByDirection([], ALICE_MAINNET, "sent"), []);
    assert.deepEqual(filterAccountHistoryByDirection([], ALICE_MAINNET, "received"), []);
    assert.deepEqual(countAccountHistoryDirections([], ALICE_MAINNET), {
      all: 0,
      sent: 0,
      received: 0,
    });
  });
});

describe("account-history-export CSV formula neutralization & RFC-4180 quoting", () => {
  it("neutralizes cells starting with =, +, -, @, tab, and CR", () => {
    assert.equal(neutralizeCsvFormula("=CMD|' /C calc'!A0"), "'=CMD|' /C calc'!A0");
    assert.equal(neutralizeCsvFormula("+1"), "'+1");
    assert.equal(neutralizeCsvFormula("-1"), "'-1");
    assert.equal(neutralizeCsvFormula("@SUM(A1:A2)"), "'@SUM(A1:A2)");
    assert.equal(neutralizeCsvFormula("\t=1+1"), "'\t=1+1");
    assert.equal(neutralizeCsvFormula("\r=1+1"), "'\r=1+1");
    assert.equal(neutralizeCsvFormula("normal text"), "normal text");
    assert.equal(neutralizeCsvFormula(""), "");
  });

  it("applies RFC-4180 quoting for commas, quotes, and newlines alongside formula neutralization", () => {
    assert.equal(escapeCsvCell('hello, "world"'), '"hello, ""world"""');
    assert.equal(escapeCsvCell("line1\nline2"), '"line1\nline2"');
    assert.equal(escapeCsvCell("=1+1,2"), `"'=1+1,2"`);
    assert.equal(escapeCsvCell("\r=1+1"), `"'\r=1+1"`);
    assert.equal(escapeCsvCell(null), "");
    assert.equal(escapeCsvCell(undefined), "");
  });

  it("serializes transactions with formula payloads and special CSV characters safely", () => {
    const txs: AccountHistoryRecord[] = [
      {
        tx: "=CMD|' /C calc'!A0",
        block: "blk,1",
        kind: "out",
        from: ALICE_MAINNET,
        to: BOB_MAINNET,
        delta: -1_000_000_000,
        memo: 'note with "quotes",\nand newline',
      },
      {
        tx: "@SUM(A1:B2)",
        block: "+1",
        kind: "in",
        delta: 2_500_000_000,
        memo: "-1",
      },
    ];

    const csv = serializeAccountHistoryCsv(txs, ALICE_MAINNET);
    assert.ok(csv.startsWith(`${ACCOUNT_HISTORY_CSV_HEADERS.join(",")}\r\n`));
    assert.ok(csv.includes(`'=CMD|' /C calc'!A0,"blk,1",sent,out,`));
    assert.ok(csv.includes(`'-1000000000,'-1,KVNC`));
    assert.ok(csv.includes(`"note with ""quotes"",\nand newline"`));
    assert.ok(csv.includes(`'@SUM(A1:B2),'+1,received,in,`));
    assert.ok(csv.includes(`,'-1\r\n`));
  });

  it("emits only the header row when serializing an empty list to CSV", () => {
    const csv = serializeAccountHistoryCsv([], ALICE_MAINNET);
    assert.equal(csv, `${ACCOUNT_HISTORY_CSV_HEADERS.join(",")}\r\n`);
  });
});

describe("account-history-export JSON export & safe filenames", () => {
  it("formats structured JSON export with address, direction, exportedAt, count, and transactions", () => {
    const txs: AccountHistoryRecord[] = [
      {
        tx: "tx-abc",
        block: "blk-123",
        kind: "in",
        delta: 1_500_000_000,
        memo: "faucet drip",
      },
    ];

    const exportedAt = "2026-11-24T10:00:00.000Z";
    const payload = buildAccountHistoryJsonPayload(txs, ALICE_TESTNET, "received", {
      exportedAt,
    });

    assert.equal(payload.address, ALICE_MAINNET);
    assert.equal(payload.direction, "received");
    assert.equal(payload.exportedAt, exportedAt);
    assert.equal(payload.count, 1);
    assert.equal(payload.transactions.length, 1);
    assert.deepEqual(payload.transactions[0], {
      txHash: "tx-abc",
      block: "blk-123",
      direction: "received",
      kind: "in",
      from: null,
      to: null,
      deltaAtoms: 1_500_000_000,
      amountKvnc: "1.5",
      asset: "KVNC",
      feeAtoms: null,
      timestamp: null,
      status: null,
      memo: "faucet drip",
    });

    const jsonText = serializeAccountHistoryJson(txs, ALICE_TESTNET, "received", {
      exportedAt,
    });
    const parsed = JSON.parse(jsonText);
    assert.deepEqual(parsed, payload);
  });

  it("serializes empty lists cleanly to JSON", () => {
    const jsonText = serializeAccountHistoryJson([], ALICE_MAINNET, "all", {
      exportedAt: "2026-11-24T10:00:00.000Z",
    });
    const parsed = JSON.parse(jsonText);
    assert.equal(parsed.count, 0);
    assert.deepEqual(parsed.transactions, []);
  });

  it("builds safe sanitized filenames for CSV and JSON exports", () => {
    assert.equal(
      buildAccountHistoryFilename(ALICE_MAINNET, "sent", "csv"),
      `kovanica-history-${ALICE_MAINNET.slice(0, 12)}-sent.csv`,
    );
    assert.equal(
      buildAccountHistoryFilename("../../etc/passwd?foo=bar", "received", "json"),
      "kovanica-history-etcpasswdfoo-received.json",
    );
    assert.equal(
      buildAccountHistoryFilename("!!!", "all", "csv"),
      "kovanica-history-account-all.csv",
    );
  });
});
