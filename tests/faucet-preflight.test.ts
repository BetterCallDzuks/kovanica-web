import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAddress } from "../src/lib/wallet/address";
import {
  FAUCET_CANONICAL_NETWORK_TAG,
  FAUCET_CHAIN_ID,
  formatFaucetCooldown,
  validateFaucetRecipient,
} from "../src/lib/faucet/preflight";

function makeSampleKey(fillByte: number): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = (fillByte + i * 7) & 0xff;
  }
  return bytes;
}

test("faucet preflight constants match canonical Kovanica Testnet Chain 2", () => {
  assert.equal(FAUCET_CANONICAL_NETWORK_TAG, "2-24cdb5fadd98b207");
  assert.equal(FAUCET_CHAIN_ID, 2);
});

test("validateFaucetRecipient accepts valid canonical kvnc...dag PRO-21 addresses", () => {
  const key = makeSampleKey(0x2a);
  const kvncAddr = encodeAddress(key);

  const verdict = validateFaucetRecipient(kvncAddr);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.format, "pro21-mainnet");
  assert.equal(verdict.canonicalAddress, kvncAddr);
  assert.equal(verdict.networkTag, FAUCET_CANONICAL_NETWORK_TAG);
  assert.equal(verdict.reason, undefined);

  // Leading/trailing whitespace and uppercase normalization are handled cleanly
  const paddedUpper = validateFaucetRecipient(`  ${kvncAddr.toUpperCase()}  `);
  assert.equal(paddedUpper.ok, true);
  assert.equal(paddedUpper.canonicalAddress, kvncAddr);
  assert.equal(paddedUpper.format, "pro21-mainnet");
});

test("validateFaucetRecipient accepts valid tknc...dag PRO-21 testnet addresses", () => {
  const key = makeSampleKey(0x5c);
  const kvncAddr = encodeAddress(key);
  const tkncAddr = `tknc${kvncAddr.slice(4)}`;

  const verdict = validateFaucetRecipient(tkncAddr);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.format, "pro21-testnet");
  assert.equal(verdict.canonicalAddress, kvncAddr);
  assert.equal(verdict.networkTag, FAUCET_CANONICAL_NETWORK_TAG);
  assert.equal(verdict.reason, undefined);
});

test("validateFaucetRecipient rejects legacy raw 64-hex and hex variants on Chain 2 Testnet", () => {
  const raw64Hex = "a".repeat(64);
  const prefixed64Hex = `0x${"b".repeat(64)}`;
  const versioned66Hex = `00${"c".repeat(64)}`;
  const legacy72Hex = `kvnc${"d".repeat(72)}dag`;

  for (const legacyInput of [raw64Hex, prefixed64Hex, versioned66Hex, legacy72Hex]) {
    const verdict = validateFaucetRecipient(legacyInput);
    assert.equal(verdict.ok, false, `Expected legacy input to be rejected: ${legacyInput}`);
    assert.equal(verdict.format, "legacy-hex");
    assert.equal(verdict.networkTag, FAUCET_CANONICAL_NETWORK_TAG);
    assert.equal(verdict.canonicalAddress, undefined);
    assert.match(verdict.reason ?? "", /legacy raw hex/i);
    assert.match(verdict.reason ?? "", /2-24cdb5fadd98b207/);
  }
});

test("validateFaucetRecipient rejects corrupted PRO-21 checksums on kvnc and tknc addresses", () => {
  const kvncAddr = encodeAddress(makeSampleKey(0x91));
  const tkncAddr = `tknc${kvncAddr.slice(4)}`;

  // Flip the last base32 character before "dag" to corrupt the 29-bit BLAKE3 checksum
  const flipChar = (addr: string): string => {
    const idx = addr.length - 4;
    const replacement = addr[idx] === "q" ? "p" : "q";
    return `${addr.slice(0, idx)}${replacement}${addr.slice(idx + 1)}`;
  };

  for (const corrupted of [flipChar(kvncAddr), flipChar(tkncAddr)]) {
    const verdict = validateFaucetRecipient(corrupted);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.format, "invalid");
    assert.equal(verdict.networkTag, FAUCET_CANONICAL_NETWORK_TAG);
    assert.match(verdict.reason ?? "", /checksum/i);
  }
});

test("validateFaucetRecipient rejects empty, malformed, invalid-alphabet, and XSS inputs", () => {
  // Empty / whitespace
  for (const empty of ["", "   ", "\t\n"]) {
    const verdict = validateFaucetRecipient(empty);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.format, "invalid");
    assert.equal(verdict.networkTag, FAUCET_CANONICAL_NETWORK_TAG);
    assert.ok(verdict.reason && verdict.reason.length > 0);
  }

  // XSS / control-character payloads must be rejected and never reflected
  for (const xss of [
    "<script>alert(1)</script>",
    "javascript:alert(1)",
    'kvnc"onmouseover="alert(1)dag',
    "kvnc\u0000dag",
  ]) {
    const verdict = validateFaucetRecipient(xss);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.format, "invalid");
    assert.equal(verdict.networkTag, FAUCET_CANONICAL_NETWORK_TAG);
    assert.ok(!(verdict.reason ?? "").includes("<script>"));
  }

  // Wrong length PRO-21
  const shortAddr = validateFaucetRecipient("kvnc12345dag");
  assert.equal(shortAddr.ok, false);
  assert.match(shortAddr.reason ?? "", /64 characters/i);

  // Invalid character outside bech32 alphabet ('b', 'i', 'o', '1')
  const badAlphabet = validateFaucetRecipient(`kvnc${"b".repeat(57)}dag`);
  assert.equal(badAlphabet.ok, false);
  assert.match(badAlphabet.reason ?? "", /base32/i);
});

test("formatFaucetCooldown formats ready, seconds, minutes, and hours cleanly", () => {
  assert.equal(formatFaucetCooldown(0), "Ready");
  assert.equal(formatFaucetCooldown(-15), "Ready");
  assert.equal(formatFaucetCooldown(Number.NaN), "Ready");
  assert.equal(formatFaucetCooldown(Number.POSITIVE_INFINITY), "Ready");

  assert.equal(formatFaucetCooldown(1), "1s");
  assert.equal(formatFaucetCooldown(45), "45s");
  assert.equal(formatFaucetCooldown(60), "1m");
  assert.equal(formatFaucetCooldown(95), "1m 35s");
  assert.equal(formatFaucetCooldown(3600), "1h");
  assert.equal(formatFaucetCooldown(3661), "1h 1m");
  assert.equal(formatFaucetCooldown(7325), "2h 2m");
});
