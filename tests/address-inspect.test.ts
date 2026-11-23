import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inspectExplorerAddress } from "../src/lib/explorer/address-inspect";
import { encodeAddress } from "../src/lib/wallet/address";

const SAMPLE_PAYLOAD_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";
const SAMPLE_PAYLOAD_BYTES = Uint8Array.from(
  SAMPLE_PAYLOAD_HEX.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
);
const SAMPLE_MAINNET = encodeAddress(SAMPLE_PAYLOAD_BYTES);
const SAMPLE_TESTNET = `tknc${SAMPLE_MAINNET.slice(4)}`;

const SECOND_PAYLOAD_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SECOND_PAYLOAD_BYTES = Uint8Array.from(
  SECOND_PAYLOAD_HEX.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
);
const SECOND_MAINNET = encodeAddress(SECOND_PAYLOAD_BYTES);
const SECOND_TESTNET = `tknc${SECOND_MAINNET.slice(4)}`;

function corruptPro21Char(address: string, index: number): string {
  const original = address[index];
  const replacement = original === "q" ? "p" : "q";
  return `${address.slice(0, index)}${replacement}${address.slice(index + 1)}`;
}

describe("inspectExplorerAddress", () => {
  it("validates a canonical PRO-21 mainnet kvnc...dag address", () => {
    const result = inspectExplorerAddress(SAMPLE_MAINNET);
    assert.equal(result.valid, true);
    assert.equal(result.format, "pro21-mainnet");
    assert.equal(result.checksumValid, true);
    assert.equal(result.canonicalMainnet, SAMPLE_MAINNET);
    assert.equal(result.canonicalTestnet, SAMPLE_TESTNET);
    assert.equal(result.payloadHex, `0x${SAMPLE_PAYLOAD_HEX}`);
    assert.equal(result.error, undefined);
  });

  it("validates a canonical PRO-21 testnet tknc...dag address", () => {
    const result = inspectExplorerAddress(`  ${SECOND_TESTNET}  `);
    assert.equal(result.valid, true);
    assert.equal(result.format, "pro21-testnet");
    assert.equal(result.checksumValid, true);
    assert.equal(result.canonicalMainnet, SECOND_MAINNET);
    assert.equal(result.canonicalTestnet, SECOND_TESTNET);
    assert.equal(result.payloadHex, `0x${SECOND_PAYLOAD_HEX}`);
    assert.equal(result.error, undefined);
  });

  it("validates bare and 0x-prefixed 64-hex addresses as legacy-hex without embedded checksum", () => {
    const bare = inspectExplorerAddress(SECOND_PAYLOAD_HEX.toUpperCase());
    assert.equal(bare.valid, true);
    assert.equal(bare.format, "legacy-hex");
    assert.equal(bare.checksumValid, false);
    assert.equal(bare.canonicalMainnet, SECOND_MAINNET);
    assert.equal(bare.canonicalTestnet, SECOND_TESTNET);
    assert.equal(bare.payloadHex, `0x${SECOND_PAYLOAD_HEX}`);

    const prefixed = inspectExplorerAddress(`0x${SAMPLE_PAYLOAD_HEX}`);
    assert.equal(prefixed.valid, true);
    assert.equal(prefixed.format, "legacy-hex");
    assert.equal(prefixed.checksumValid, false);
    assert.equal(prefixed.canonicalMainnet, SAMPLE_MAINNET);
    assert.equal(prefixed.canonicalTestnet, SAMPLE_TESTNET);
    assert.equal(prefixed.payloadHex, `0x${SAMPLE_PAYLOAD_HEX}`);
  });

  it("rejects corrupted PRO-21 checksums for both kvnc...dag and tknc...dag", () => {
    const corruptedMainnetBody = corruptPro21Char(SAMPLE_MAINNET, 10);
    const corruptedMainnetCheck = corruptPro21Char(SAMPLE_MAINNET, SAMPLE_MAINNET.length - 4);
    const corruptedTestnetCheck = corruptPro21Char(SECOND_TESTNET, SECOND_TESTNET.length - 4);

    for (const bad of [corruptedMainnetBody, corruptedMainnetCheck, corruptedTestnetCheck]) {
      const result = inspectExplorerAddress(bad);
      assert.equal(result.valid, false);
      assert.equal(result.format, "invalid");
      assert.equal(result.checksumValid, false);
      assert.equal(result.canonicalMainnet, undefined);
      assert.equal(result.canonicalTestnet, undefined);
      assert.equal(result.payloadHex, undefined);
      assert.match(result.error ?? "", /checksum mismatch/i);
    }
  });

  it("rejects malformed and XSS inputs without throwing", () => {
    const invalidInputs: unknown[] = [
      "",
      "   ",
      "kvncshortdag",
      "tkncshortdag",
      SAMPLE_MAINNET.toUpperCase(),
      `kvnc${"o".repeat(57)}dag`,
      "0x1234",
      "g".repeat(64),
      "<script>alert(1)</script>",
      "javascript:alert(document.cookie)",
      `kvnc<img src=x onerror=alert(1)>dag`,
      null,
      undefined,
      12345,
    ];

    for (const raw of invalidInputs) {
      const result = inspectExplorerAddress(raw as string);
      assert.equal(result.valid, false);
      assert.equal(result.format, "invalid");
      assert.equal(result.checksumValid, false);
      assert.equal(typeof result.error, "string");
      assert.ok((result.error ?? "").length > 0);
    }
  });
});
