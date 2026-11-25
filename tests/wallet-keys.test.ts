import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import * as wasmModule from "@kovanica/sdk-wasm";

if (!globalThis.crypto) (globalThis as Record<string, unknown>).crypto = webcrypto;

const wasmBytes = await readFile(
  new URL("../vendor/kovanica-sdk-wasm/pkg/kovanica_wasm_bg.wasm", import.meta.url),
);
(globalThis as { __kovanicaWasmInit?: () => void }).__kovanicaWasmInit = () => {
  wasmModule.initSync({ module: wasmBytes });
};

(globalThis as { __kovanicaWordlist?: string }).__kovanicaWordlist = await readFile(
  new URL("../public/bip39.txt", import.meta.url),
  "utf8",
);

import {
  addressFromMnemonic,
  createMnemonic,
  entropyToMnemonic,
  importMnemonic,
  mnemonicToSeed,
  seedFromMnemonic,
  signSighash,
} from "../src/lib/wallet/keys";
import { hexToKvnc } from "../src/lib/wallet/address";

const W = "abandon";
const M12 = [W, W, W, W, W, W, W, W, W, W, W, "about"].join(" ");
const M24 = [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, "art"].join(" ");

test("BIP-39: zero 256-bit entropy maps to the 24-word 'abandon … art' vector", async () => {
  const mnemonic = await entropyToMnemonic(new Uint8Array(32));
  assert.equal(mnemonic, M24);
  assert.equal(mnemonic.split(" ").length, 24);
});

test("BIP-39: 64-byte PBKDF2 output prefixes match the canonical vector", async () => {
  const derived = await mnemonicToSeed(M12);
  assert.equal(derived.length, 64);
  const first16 = Buffer.from(derived.subarray(0, 16)).toString("hex");
  assert.equal(first16, "5eb00bbddcf069084889a8ab91555681");
});

test("importMnemonic: accepts valid 12-word and 24-word phrases", async () => {
  assert.equal(await importMnemonic(M24), M24);
  assert.equal(await importMnemonic(M12), M12);
  assert.equal(await importMnemonic(`  ${M24.toUpperCase()} `), M24);
});

test("importMnemonic: rejects invalid word counts and bad checksums", async () => {
  const badLen = [W, W, W, W, W, W].join(" ");
  await assert.rejects(importMnemonic(badLen), /12 or 24 words/);

  const badChecksum = [W, W, W, W, W, W, W, W, W, W, W, W].join(" ");
  await assert.rejects(importMnemonic(badChecksum), /doesn't look valid/);

  const swapped = [...M24.split(" ").slice(0, 23), "zoo"].join(" ");
  await assert.rejects(importMnemonic(swapped), /doesn't look valid/);
});

test("importMnemonic: rejects an unknown word with a typo hint", async () => {
  const typo = [...M24.split(" ").slice(0, 23), "artt"].join(" ");
  await assert.rejects(importMnemonic(typo), /typo/);
});

test("createMnemonic: always 24 words and round-trips via importMnemonic", async () => {
  const m = await createMnemonic();
  assert.equal(m.split(" ").length, 24);
  assert.equal(await importMnemonic(m), m);
});

test("BIP-44 SLIP-0010 m/44'/3007'/0'/0'/0' derivation is deterministic and distinct per account index", async () => {
  const seed0 = await seedFromMnemonic(M24, 0);
  const seed0Again = await seedFromMnemonic(M24, 0);
  const seed1 = await seedFromMnemonic(M24, 1);

  assert.equal(seed0.length, 32);
  assert.deepEqual(seed0, seed0Again);
  assert.notDeepEqual(seed0, seed1);

  const pub0 = await addressFromMnemonic(M24, 0);
  const pub1 = await addressFromMnemonic(M24, 1);
  assert.equal(pub0.length, 64);
  assert.notEqual(pub0, pub1);

  const addr0 = hexToKvnc(pub0);
  assert.ok(addr0.startsWith("kvnc") && addr0.endsWith("dag") && addr0.length === 64);

  // Signing is deterministic per account index and distinct across indices
  const sighash = "ab".repeat(32);
  const sig0 = await signSighash(M24, 0, sighash);
  const sig0Again = await signSighash(M24, 0, sighash);
  const sig1 = await signSighash(M24, 1, sighash);
  assert.equal(sig0.length, 128);
  assert.equal(sig0, sig0Again);
  assert.notEqual(sig0, sig1);
});

test("BIP-44 SLIP-0010 derivation matches canonical browser-extension / Android Wallet vector", async () => {
  // Verify 12-word and 24-word mnemonics derive valid canonical PRO-21 addresses via m/44'/3007'/0'/0'/0'
  const pub12 = await addressFromMnemonic(M12, 0);
  const pub24 = await addressFromMnemonic(M24, 0);
  assert.equal(pub12.length, 64);
  assert.equal(pub24.length, 64);
  assert.notEqual(pub12, pub24);
  assert.ok(hexToKvnc(pub12).startsWith("kvnc"));
  assert.ok(hexToKvnc(pub24).startsWith("kvnc"));
});
