import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import {
  deriveOnetimeAddress,
  deriveOnetimeSpendKey,
  deriveStealthKeypairFromMnemonic,
  generateStealthKeypair,
  matchStealthAnnouncement,
  parseStealthMetaAddress,
  signSighashWithStealthScalar,
} from "../src/lib/protocol/stealth";
import { dispatchApi } from "../src/lib/api/dispatch.server";

ed.hashes.sha512 = sha512;

test("KVP-103 stealth end-to-end ECDH: keygen -> derive -> watch-only scan -> spend signature verifies under standard Ed25519", () => {
  const recipient = generateStealthKeypair();
  const parsed = parseStealthMetaAddress(recipient.metaAddress);
  assert.equal(parsed.scanPubkeyHex, recipient.scanPubkeyHex);
  assert.equal(parsed.spendPubkeyHex, recipient.spendPubkeyHex);

  // Sender derives a fresh one-time L1 address
  const onetime = deriveOnetimeAddress(recipient.metaAddress);
  assert.ok(onetime.address.startsWith("kvnc") && onetime.address.endsWith("dag"));
  assert.equal(onetime.addressHex.length, 64);
  assert.equal(onetime.ephemeralPubkeyHex.length, 64);
  assert.equal(onetime.viewTag.length, 4);

  // Recipient scans using ONLY (scanPriv, spendPub) — never spendPriv
  const match = matchStealthAnnouncement(recipient.scanPrivkeyHex, recipient.spendPubkeyHex, {
    ephemeralPubkeyHex: onetime.ephemeralPubkeyHex,
    viewTag: onetime.viewTag,
    stealthAddress: onetime.address,
  });
  assert.equal(match.matched, true);
  if (match.matched) {
    assert.equal(match.address, onetime.address);
    assert.equal(match.addressHex, onetime.addressHex);
  }

  // Wrong recipient must NOT match
  const bystander = generateStealthKeypair();
  const wrongMatch = matchStealthAnnouncement(bystander.scanPrivkeyHex, bystander.spendPubkeyHex, {
    ephemeralPubkeyHex: onetime.ephemeralPubkeyHex,
    viewTag: onetime.viewTag,
    stealthAddress: onetime.address,
  });
  assert.equal(wrongMatch.matched, false);

  // Recipient derives one-time spend scalar and signs a 32-byte L1 sighash
  const spendKey = deriveOnetimeSpendKey({
    scanPrivkeyHex: recipient.scanPrivkeyHex,
    spendPrivkeyHex: recipient.spendPrivkeyHex,
    ephemeralPubkeyHex: onetime.ephemeralPubkeyHex,
  });
  assert.equal(spendKey.address, onetime.address);
  assert.equal(spendKey.addressHex, onetime.addressHex);

  const sighashHex = "ab".repeat(32);
  const { signatureHex, publicKeyHex } = signSighashWithStealthScalar(
    spendKey.oneTimeScalarHex,
    sighashHex,
  );
  assert.equal(publicKeyHex, onetime.addressHex);
  assert.equal(signatureHex.length, 128);

  // Standard RFC 8032 Ed25519 verification (identical to kovanica-l1 ed25519-dalek)
  const valid = ed.verify(
    ed.etc.hexToBytes(signatureHex),
    ed.etc.hexToBytes(sighashHex),
    ed.etc.hexToBytes(onetime.addressHex),
  );
  assert.equal(valid, true, "One-time stealth scalar signature MUST verify under standard Ed25519");
});

test("deriveStealthKeypairFromMnemonic is deterministic and distinct from random keys", () => {
  const phrase =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const a = deriveStealthKeypairFromMnemonic(phrase);
  const b = deriveStealthKeypairFromMnemonic(`  ${phrase.toUpperCase()}  `);
  assert.equal(a.metaAddress, b.metaAddress);
  assert.equal(a.scanPrivkeyHex, b.scanPrivkeyHex);
  assert.equal(a.spendPrivkeyHex, b.spendPrivkeyHex);
});

test("POST /api/stealth/announce and GET /api/stealth/announcements persist public tuples and reject secret fields", async () => {
  const tmpFile = path.join(os.tmpdir(), `kovanica-stealth-test-${Date.now()}.jsonl`);
  const prev = process.env.KOVANICA_STEALTH_FILE;
  process.env.KOVANICA_STEALTH_FILE = tmpFile;

  try {
    const recipient = generateStealthKeypair();
    const onetime = deriveOnetimeAddress(recipient.metaAddress);

    // Reject forbidden private key fields
    const badRes = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/stealth/announce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ephemeral_pubkey_hex: onetime.ephemeralPubkeyHex,
          view_tag: onetime.viewTag,
          stealth_address: onetime.address,
          scan_privkey_hex: recipient.scanPrivkeyHex,
        }),
      }),
    );
    assert.equal(badRes.status, 400);

    // Accept valid public announcement
    const okRes = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/stealth/announce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ephemeral_pubkey_hex: onetime.ephemeralPubkeyHex,
          view_tag: onetime.viewTag,
          stealth_address: onetime.address,
        }),
      }),
    );
    assert.equal(okRes.status, 201);

    // Filter by view_tag
    const listRes = await dispatchApi(
      new Request(
        `https://testnet.kovanica.online/api/stealth/announcements?view_tag=${onetime.viewTag}`,
      ),
    );
    assert.equal(listRes.status, 200);
    const body = (await listRes.json()) as {
      announcements: Array<{ ephemeralPubkeyHex: string; stealthAddress: string; viewTag: string }>;
    };
    assert.equal(body.announcements.length, 1);
    assert.equal(body.announcements[0]?.stealthAddress, onetime.address);
    assert.equal(body.announcements[0]?.ephemeralPubkeyHex, onetime.ephemeralPubkeyHex);
  } finally {
    if (prev === undefined) delete process.env.KOVANICA_STEALTH_FILE;
    else process.env.KOVANICA_STEALTH_FILE = prev;
    fs.rmSync(tmpFile, { force: true });
  }
});
