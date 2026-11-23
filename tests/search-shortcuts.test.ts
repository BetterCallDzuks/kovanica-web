import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SHORTCUT_QUERY_LENGTH,
  resolveSearchShortcuts,
} from "../src/lib/search/shortcuts";
import { parseContractInspectorDeepLink } from "../src/lib/contracts/dry-run";

// Frozen protocol vectors from protocol/testvectors/vectors.json
const ADDR_1 = "kvnc8d4z00xwk6jz6c4r4rgz5mcdwdjny9thrh3y8f36cpy2rz6emg54rufktdag";
const PUBKEY_1 = "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";
const TX_HASH_1 = "0x1111111111111111111111111111111111111111111111111111111111111111";

test("name:<alice> returns Name Registry resolve and Storage Slot read shortcuts", () => {
  const shortcuts = resolveSearchShortcuts("name:alice");
  assert.equal(shortcuts.length, 2);

  const resolveAction = shortcuts.find((s) => s.id === "name-resolve");
  assert.ok(resolveAction);
  assert.equal(resolveAction.label, "Resolve Name in Contract Inspector");
  assert.equal(resolveAction.badge, "Name");
  assert.match(resolveAction.href, /^\/explorer\?tab=contracts&preset=name_resolve&args=/);

  // Verify the generated deep-link round-trips cleanly through parseContractInspectorDeepLink
  const parsed = parseContractInspectorDeepLink(resolveAction.href.split("?")[1] ?? "");
  assert.equal(parsed.isContractsTab, true);
  assert.equal(parsed.presetId, "name_resolve");
  assert.deepEqual(parsed.fields, { name: "alice" });

  const storageAction = shortcuts.find((s) => s.id === "storage-read");
  assert.ok(storageAction);
  assert.equal(storageAction.label, "Read Storage Slot");
  assert.equal(storageAction.badge, "Storage");
  assert.equal(storageAction.href, "/explorer?tab=contracts&preset=name_resolve");

  // Case-insensitive prefix and whitespace trimming
  const upperShortcuts = resolveSearchShortcuts("  NAME:Alice-42  ");
  assert.equal(upperShortcuts.length, 2);
  const upperParsed = parseContractInspectorDeepLink(upperShortcuts[0]!.href.split("?")[1] ?? "");
  assert.deepEqual(upperParsed.fields, { name: "alice-42" });
});

test("valid kvnc...dag address returns Inspect Address / Contract and Open in Contract Inspector", () => {
  const shortcuts = resolveSearchShortcuts(ADDR_1);
  assert.equal(shortcuts.length, 2);

  const inspectAddress = shortcuts.find((s) => s.id === "inspect-address");
  assert.ok(inspectAddress);
  assert.equal(inspectAddress.label, "Inspect Address / Contract");
  assert.equal(inspectAddress.href, `/explorer?address=${ADDR_1}`);
  assert.equal(inspectAddress.badge, "Address");

  const openInspector = shortcuts.find((s) => s.id === "open-contract-inspector");
  assert.ok(openInspector);
  assert.equal(openInspector.label, "Open in Contract Inspector");
  assert.equal(openInspector.href, `/explorer?tab=contracts&contract=${ADDR_1}`);
  assert.equal(openInspector.badge, "Contract");

  // Uppercase / whitespace-padded canonical address normalizes to lowercase
  const padded = resolveSearchShortcuts(`  ${ADDR_1.toUpperCase()}  `);
  assert.equal(padded.length, 2);
  assert.equal(padded[0]!.href, `/explorer?address=${ADDR_1}`);
  assert.equal(padded[1]!.href, `/explorer?tab=contracts&contract=${ADDR_1}`);

  // Explicit address/contract prefix
  const prefixed = resolveSearchShortcuts(`contract:${ADDR_1}`);
  assert.equal(prefixed.length, 2);
  assert.equal(prefixed[1]!.href, `/explorer?tab=contracts&contract=${ADDR_1}`);
});

test("bare 32-byte hex address canonicalizes to kvnc...dag for Address and Contract Inspector", () => {
  const shortcuts = resolveSearchShortcuts(PUBKEY_1);
  assert.equal(shortcuts.length, 2);
  assert.equal(shortcuts[0]!.id, "inspect-address");
  assert.equal(shortcuts[0]!.href, `/explorer?address=${ADDR_1}`);
  assert.equal(shortcuts[1]!.id, "open-contract-inspector");
  assert.equal(shortcuts[1]!.href, `/explorer?tab=contracts&contract=${ADDR_1}`);
});

test("32-byte 0x... transaction hash returns Inspect Receipt & Decode Logs plus address/contract shortcuts", () => {
  const shortcuts = resolveSearchShortcuts(TX_HASH_1);
  const receipt = shortcuts.find((s) => s.id === "inspect-receipt");
  assert.ok(receipt);
  assert.equal(receipt.label, "Inspect Receipt & Decode Logs");
  assert.equal(receipt.href, `/explorer?tab=contracts&tx=${TX_HASH_1}`);
  assert.equal(receipt.badge, "Receipt");

  // Uppercase 0X prefix normalizes to lowercase 0x...
  const upperTx = resolveSearchShortcuts(`0X${"AB".repeat(32)}`);
  const upperReceipt = upperTx.find((s) => s.id === "inspect-receipt");
  assert.ok(upperReceipt);
  assert.equal(upperReceipt.href, `/explorer?tab=contracts&tx=0x${"ab".repeat(32)}`);

  // Explicit tx: prefix returns only the receipt shortcut
  const prefixedTx = resolveSearchShortcuts(`tx:${TX_HASH_1}`);
  assert.equal(prefixedTx.length, 1);
  assert.equal(prefixedTx[0]!.id, "inspect-receipt");
  assert.equal(prefixedTx[0]!.href, `/explorer?tab=contracts&tx=${TX_HASH_1}`);
});

test("empty, whitespace, and malformed inputs return no shortcuts without throwing", () => {
  const malformedInputs = [
    "",
    "   ",
    "\t\n",
    "name:",
    "name:   ",
    "name:-leading-hyphen",
    "name:has spaces",
    "name:alice/bob",
    "name:alice&tab=evil",
    "kvnc12345dag",
    `kvnc${"0".repeat(57)}dag`, // bad checksum
    "0x1234567890abcdef", // short hex
    `0x${"g".repeat(64)}`, // non-hex
    "tx:not-a-hash",
    "addr:invalid",
    "random unrecognized text",
  ];

  for (const input of malformedInputs) {
    assert.doesNotThrow(() => resolveSearchShortcuts(input));
    assert.deepEqual(resolveSearchShortcuts(input), [], `expected [] for input: ${JSON.stringify(input)}`);
  }
});

test("XSS payloads and oversized inputs are strictly rejected", () => {
  const xssInputs = [
    "name:<script>alert(1)</script>",
    'name:alice" onclick="alert(1)',
    "name:'><img src=x onerror=alert(1)>",
    "name:javascript:alert(1)",
    "<script>alert(1)</script>",
    `name:alice\u0000evil`,
    `0x${"1".repeat(64)}<script>`,
  ];

  for (const payload of xssInputs) {
    assert.deepEqual(
      resolveSearchShortcuts(payload),
      [],
      `expected XSS payload to be rejected: ${JSON.stringify(payload)}`,
    );
  }

  // Oversized inputs (> MAX_SHORTCUT_QUERY_LENGTH)
  const oversizedName = `name:${"a".repeat(MAX_SHORTCUT_QUERY_LENGTH + 10)}`;
  assert.deepEqual(resolveSearchShortcuts(oversizedName), []);

  const oversizedPaddedAddress = `${" ".repeat(MAX_SHORTCUT_QUERY_LENGTH)}${ADDR_1}`;
  assert.deepEqual(resolveSearchShortcuts(oversizedPaddedAddress), []);

  // Name longer than 63 chars
  const tooLongName = `name:${"a".repeat(64)}`;
  assert.deepEqual(resolveSearchShortcuts(tooLongName), []);
});
