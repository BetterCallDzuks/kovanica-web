import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, concatBytes, u64le } from "../src/lib/contracts/decoders";
import {
  STORAGE_KEY_PREFIXES,
  decodeStorageValue,
  decodeU128Be,
  decodeU128Le,
  decodeU64Be,
  decodeU64Le,
  decodeUtf8Preview,
  derivePrefixedStorageSlot,
  deriveSlotByMode,
  deriveStorageSlot,
  deriveStorageSlotHex,
} from "../src/lib/explorer/storage-slot";
import { encodeAddress } from "../src/lib/wallet/address";

const UTF8 = new TextEncoder();

describe("deriveStorageSlot & deriveStorageSlotHex (kovanica-sdk parity)", () => {
  it("matches SDK singleton slot vectors for state, token, nft, multisig, and token_pool", () => {
    const expectedState = blake3(UTF8.encode("kvnc/v1/state"));
    const expectedPool = blake3(UTF8.encode("kvnc/v1/pool"));

    assert.deepEqual(deriveStorageSlot("state"), expectedState);
    assert.deepEqual(deriveStorageSlot("token"), expectedState);
    assert.deepEqual(deriveStorageSlot("nft"), expectedState);
    assert.deepEqual(deriveStorageSlot("multisig"), expectedState);
    assert.equal(deriveStorageSlotHex("token"), bytesToHex(expectedState));
    assert.equal(deriveStorageSlotHex("state").length, 64);

    assert.deepEqual(deriveStorageSlot("token_pool"), expectedPool);
    assert.equal(deriveStorageSlotHex("token_pool"), bytesToHex(expectedPool));
  });

  it("matches SDK 32-byte keyed slot vectors for token_lp, htlc, vault, and escrow", () => {
    const id = new Uint8Array(32).fill(0xab);
    const idHex = `0x${bytesToHex(id)}`;
    const idAddress = encodeAddress(id);

    assert.equal(
      deriveStorageSlotHex("token_lp", id),
      bytesToHex(blake3(concatBytes([UTF8.encode(STORAGE_KEY_PREFIXES.LP), id]))),
    );
    assert.equal(deriveStorageSlotHex("token_lp", idHex), deriveStorageSlotHex("token_lp", id));
    assert.equal(deriveStorageSlotHex("token_lp", idAddress), deriveStorageSlotHex("token_lp", id));

    assert.equal(
      deriveStorageSlotHex("htlc", id),
      bytesToHex(blake3(concatBytes([UTF8.encode(STORAGE_KEY_PREFIXES.HTLC), id]))),
    );
    assert.equal(deriveStorageSlotHex("htlc", idHex), deriveStorageSlotHex("htlc", id));

    assert.equal(
      deriveStorageSlotHex("vault", id),
      bytesToHex(blake3(concatBytes([UTF8.encode(STORAGE_KEY_PREFIXES.VAULT), id]))),
    );
    assert.equal(
      deriveStorageSlotHex("escrow", id),
      bytesToHex(blake3(concatBytes([UTF8.encode(STORAGE_KEY_PREFIXES.ESCROW), id]))),
    );
  });

  it("matches SDK multisig_tx u64 LE slot vector", () => {
    const expected = bytesToHex(
      blake3(concatBytes([UTF8.encode(STORAGE_KEY_PREFIXES.MULTISIG_TX), u64le(42n)])),
    );
    assert.equal(deriveStorageSlotHex("multisig_tx", 42n), expected);
    assert.equal(deriveStorageSlotHex("multisig_tx", 42), expected);
    assert.equal(deriveStorageSlotHex("multisig_tx", u64le(42n)), expected);
  });

  it("matches SDK name slot vector with trim and lowercase normalization", () => {
    const expected = bytesToHex(
      blake3(concatBytes([UTF8.encode(STORAGE_KEY_PREFIXES.NAME), UTF8.encode("alice")])),
    );
    assert.equal(deriveStorageSlotHex("name", "Alice"), expected);
    assert.equal(deriveStorageSlotHex("name", "  ALICE  "), expected);
  });

  it("matches derivePrefixedStorageSlot directly", () => {
    const slot = derivePrefixedStorageSlot("custom:", "key-1");
    assert.deepEqual(slot, blake3(UTF8.encode("custom:key-1")));
  });

  it("rejects missing or invalid keys fail-closed", () => {
    assert.throws(() => deriveStorageSlot("htlc"), /requires a 32-byte key/);
    assert.throws(() => deriveStorageSlot("htlc", new Uint8Array(16)), /exactly 32 bytes/);
    assert.throws(() => deriveStorageSlot("vault", 123n), /32-byte/);
    assert.throws(() => deriveStorageSlot("multisig_tx"), /requires a u64 txId/);
    assert.throws(() => deriveStorageSlot("multisig_tx", "42"), /bigint, number, or 8-byte/);
    assert.throws(() => deriveStorageSlot("multisig_tx", new Uint8Array(4)), /must be 8 bytes/);
    assert.throws(() => deriveStorageSlot("name", ""), /non-empty name/);
    assert.throws(() => deriveStorageSlot("name", "   "), /non-empty name/);
  });
});

describe("deriveSlotByMode (Explorer UI modes & validation)", () => {
  it("validates and normalizes raw_hex mode", () => {
    const raw = "0x" + "AB".repeat(32);
    const res = deriveSlotByMode({ mode: "raw_hex", rawHex: raw });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.slotHex, "0x" + "ab".repeat(32));
      assert.equal(res.slotHexBare, "ab".repeat(32));
      assert.equal(res.preimageBytes, 32);
    }

    const badLen = deriveSlotByMode({ mode: "raw_hex", rawHex: "0x1234" });
    assert.equal(badLen.ok, false);
    const badChars = deriveSlotByMode({ mode: "raw_hex", rawHex: "z".repeat(64) });
    assert.equal(badChars.ok, false);
  });

  it("derives utf8 mode matching SDK singleton slots", () => {
    const res = deriveSlotByMode({ mode: "utf8", utf8Key: "kvnc/v1/state" });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.slotHexBare, deriveStorageSlotHex("state"));
      assert.equal(res.slotHex, `0x${deriveStorageSlotHex("state")}`);
    }

    const empty = deriveSlotByMode({ mode: "utf8", utf8Key: "   " });
    assert.equal(empty.ok, false);
  });

  it("derives mapping mode for utf8, address_or_hex32, u64le, and raw hex keys", () => {
    // Name mapping
    const nameRes = deriveSlotByMode({
      mode: "mapping",
      prefix: STORAGE_KEY_PREFIXES.NAME,
      key: "Alice",
      encoding: "utf8",
      lowercaseUtf8: true,
    });
    assert.equal(nameRes.ok, true);
    if (nameRes.ok) {
      assert.equal(nameRes.slotHexBare, deriveStorageSlotHex("name", "alice"));
    }

    // LP mapping with PRO-21 kvnc...dag address
    const pk = new Uint8Array(32).fill(0x22);
    const lpRes = deriveSlotByMode({
      mode: "mapping",
      prefix: STORAGE_KEY_PREFIXES.LP,
      key: encodeAddress(pk),
      encoding: "address_or_hex32",
    });
    assert.equal(lpRes.ok, true);
    if (lpRes.ok) {
      assert.equal(lpRes.slotHexBare, deriveStorageSlotHex("token_lp", pk));
    }

    // Multisig tx mapping with u64le
    const mtxRes = deriveSlotByMode({
      mode: "mapping",
      prefix: STORAGE_KEY_PREFIXES.MULTISIG_TX,
      key: "42",
      encoding: "u64le",
    });
    assert.equal(mtxRes.ok, true);
    if (mtxRes.ok) {
      assert.equal(mtxRes.slotHexBare, deriveStorageSlotHex("multisig_tx", 42n));
    }

    // Raw hex key mapping
    const hexRes = deriveSlotByMode({
      mode: "mapping",
      prefix: "custom/",
      key: "0xdeadbeef",
      encoding: "hex",
    });
    assert.equal(hexRes.ok, true);
    if (hexRes.ok) {
      const expected = bytesToHex(
        blake3(concatBytes([UTF8.encode("custom/"), new Uint8Array([0xde, 0xad, 0xbe, 0xef])])),
      );
      assert.equal(hexRes.slotHexBare, expected);
    }

    // Invalid mapping keys
    assert.equal(
      deriveSlotByMode({
        mode: "mapping",
        prefix: STORAGE_KEY_PREFIXES.MULTISIG_TX,
        key: "-1",
        encoding: "u64le",
      }).ok,
      false,
    );
    assert.equal(
      deriveSlotByMode({
        mode: "mapping",
        prefix: STORAGE_KEY_PREFIXES.LP,
        key: "0x1234",
        encoding: "address_or_hex32",
      }).ok,
      false,
    );
  });
});

describe("decodeStorageValue & integer/UTF-8 helpers", () => {
  it("handles empty and all-zero 32-byte slots", () => {
    const empty = decodeStorageValue("0x");
    assert.equal(empty.validHex, true);
    assert.equal(empty.isEmpty, true);
    assert.equal(empty.byteLength, 0);

    const zero32 = decodeStorageValue("0x" + "00".repeat(32));
    assert.equal(zero32.validHex, true);
    assert.equal(zero32.isEmpty, true);
    assert.equal(zero32.isAllZero, true);
    assert.equal(zero32.u64Be, "0");
    assert.equal(zero32.u64Le, "0");
    assert.equal(zero32.address, null);
    assert.equal(zero32.utf8Preview, null);
  });

  it("decodes 8-byte u64 (LE and BE) accurately", () => {
    // 0x0000000000000100 -> BE = 256, LE = 256 * 2^48 = 72057594037927936
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00]);
    assert.equal(decodeU64Be(bytes), 256n);
    assert.equal(decodeU64Le(bytes), 1n << 48n);

    const decoded = decodeStorageValue(`0x${bytesToHex(bytes)}`);
    assert.equal(decoded.u64Be, "256");
    assert.equal(decoded.u64Le, (1n << 48n).toString());
    assert.equal(decoded.u128Le, null);
  });

  it("decodes 16-byte u128 (LE and BE) accurately", () => {
    const bytes = new Uint8Array(16);
    bytes[0] = 0x05; // LE = 5
    bytes[15] = 0x01; // BE = 0x0500...0001
    assert.equal(decodeU128Le(bytes), 5n + (1n << 120n));
    assert.equal(decodeU128Be(bytes), (5n << 120n) + 1n);

    const decoded = decodeStorageValue(`0x${bytesToHex(bytes)}`);
    assert.equal(decoded.u128Le, (5n + (1n << 120n)).toString());
    assert.equal(decoded.u128Be, ((5n << 120n) + 1n).toString());
  });

  it("decodes 32-byte address and padded BE integer", () => {
    const bytes = new Uint8Array(32);
    bytes[31] = 0x2a; // 42 in BE
    const decoded = decodeStorageValue(`0x${bytesToHex(bytes)}`);
    assert.equal(decoded.isEmpty, false);
    assert.equal(decoded.u64Be, "42");
    assert.equal(decoded.u128Be, "42");
    assert.equal(decoded.u256Be, "42");
    assert.equal(decoded.address, encodeAddress(bytes));
  });

  it("decodes printable UTF-8 preview and rejects binary control bytes", () => {
    const textBytes = UTF8.encode("Kovanica DAG");
    assert.equal(decodeUtf8Preview(textBytes), "Kovanica DAG");
    const decodedText = decodeStorageValue(`0x${bytesToHex(textBytes)}`);
    assert.equal(decodedText.utf8Preview, "Kovanica DAG");

    const binaryBytes = new Uint8Array([0x00, 0xff, 0x01, 0x02]);
    assert.equal(decodeUtf8Preview(binaryBytes), null);
    const decodedBin = decodeStorageValue(`0x${bytesToHex(binaryBytes)}`);
    assert.equal(decodedBin.utf8Preview, null);
  });

  it("marks malformed hex as validHex: false without throwing", () => {
    const bad = decodeStorageValue("0x123");
    assert.equal(bad.validHex, false);
    assert.equal(bad.byteLength, 0);
  });
});
