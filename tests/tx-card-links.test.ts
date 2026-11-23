import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTxContractInspectorUrl,
  buildTxReceiptInspectorUrl,
} from "../src/components/explorer/tx-card";
import { hexToKvnc } from "../src/lib/wallet/address";

const SAMPLE_TX_HEX_LOWER =
  "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SAMPLE_TX_HEX_UPPER = SAMPLE_TX_HEX_LOWER.toUpperCase();

const SAMPLE_CONTRACT_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";
const SAMPLE_CONTRACT_CANONICAL = hexToKvnc(SAMPLE_CONTRACT_HEX);

describe("buildTxReceiptInspectorUrl", () => {
  it("builds a canonical deep-link URL for a bare 32-byte hex hash", () => {
    const url = buildTxReceiptInspectorUrl(SAMPLE_TX_HEX_LOWER);
    assert.equal(
      url,
      `/explorer?tab=contracts&tx=0x${SAMPLE_TX_HEX_LOWER}`,
    );
  });

  it("accepts 0x-prefixed, uppercase, and whitespace-padded 32-byte hex hashes", () => {
    assert.equal(
      buildTxReceiptInspectorUrl(`0x${SAMPLE_TX_HEX_LOWER}`),
      `/explorer?tab=contracts&tx=0x${SAMPLE_TX_HEX_LOWER}`,
    );
    assert.equal(
      buildTxReceiptInspectorUrl(`  0X${SAMPLE_TX_HEX_UPPER}  `),
      `/explorer?tab=contracts&tx=0x${SAMPLE_TX_HEX_LOWER}`,
    );
  });

  it("returns null for empty, nullish, short, oversized, or non-hex inputs", () => {
    assert.equal(buildTxReceiptInspectorUrl(null), null);
    assert.equal(buildTxReceiptInspectorUrl(undefined), null);
    assert.equal(buildTxReceiptInspectorUrl(""), null);
    assert.equal(buildTxReceiptInspectorUrl("   "), null);
    assert.equal(buildTxReceiptInspectorUrl("0x1234"), null);
    assert.equal(buildTxReceiptInspectorUrl(`${SAMPLE_TX_HEX_LOWER}ff`), null);
    assert.equal(buildTxReceiptInspectorUrl("z".repeat(64)), null);
    assert.equal(buildTxReceiptInspectorUrl(SAMPLE_CONTRACT_CANONICAL), null);
  });

  it("rejects XSS and query-injection payloads cleanly", () => {
    assert.equal(buildTxReceiptInspectorUrl("javascript:alert(1)"), null);
    assert.equal(
      buildTxReceiptInspectorUrl("<script>alert(1)</script>"),
      null,
    );
    assert.equal(
      buildTxReceiptInspectorUrl(`0x${SAMPLE_TX_HEX_LOWER}&evil=1`),
      null,
    );
    assert.equal(
      buildTxReceiptInspectorUrl(`0x${SAMPLE_TX_HEX_LOWER}#frag`),
      null,
    );
  });
});

describe("buildTxContractInspectorUrl", () => {
  it("builds a canonical deep-link URL from a canonical kvnc…dag address", () => {
    const url = buildTxContractInspectorUrl(SAMPLE_CONTRACT_CANONICAL);
    assert.equal(
      url,
      `/explorer?tab=contracts&contract=${SAMPLE_CONTRACT_CANONICAL}`,
    );
  });

  it("canonicalizes 32-byte hex contract addresses (with or without 0x) into kvnc…dag", () => {
    const expected = `/explorer?tab=contracts&contract=${SAMPLE_CONTRACT_CANONICAL}`;
    assert.equal(buildTxContractInspectorUrl(SAMPLE_CONTRACT_HEX), expected);
    assert.equal(
      buildTxContractInspectorUrl(`0x${SAMPLE_CONTRACT_HEX}`),
      expected,
    );
    assert.equal(
      buildTxContractInspectorUrl(`  0X${SAMPLE_CONTRACT_HEX.toUpperCase()}  `),
      expected,
    );
  });

  it("returns null for empty, nullish, short, or malformed contract addresses", () => {
    assert.equal(buildTxContractInspectorUrl(null), null);
    assert.equal(buildTxContractInspectorUrl(undefined), null);
    assert.equal(buildTxContractInspectorUrl(""), null);
    assert.equal(buildTxContractInspectorUrl("   "), null);
    assert.equal(buildTxContractInspectorUrl("0xdeadbeef"), null);
    assert.equal(buildTxContractInspectorUrl("kvncinvalidaddressdag"), null);
    // Corrupted checksum on canonical address
    const corrupted =
      SAMPLE_CONTRACT_CANONICAL.slice(0, -4) +
      (SAMPLE_CONTRACT_CANONICAL.slice(-4, -3) === "q" ? "p" : "q") +
      "dag";
    assert.equal(buildTxContractInspectorUrl(corrupted), null);
  });

  it("rejects XSS and query-injection payloads cleanly", () => {
    assert.equal(buildTxContractInspectorUrl("javascript:alert(1)"), null);
    assert.equal(
      buildTxContractInspectorUrl("<img src=x onerror=alert(1)>"),
      null,
    );
    assert.equal(
      buildTxContractInspectorUrl(`${SAMPLE_CONTRACT_CANONICAL}&tab=overview`),
      null,
    );
    assert.equal(
      buildTxContractInspectorUrl(`https://evil.example/${SAMPLE_CONTRACT_CANONICAL}`),
      null,
    );
  });
});
