import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BincodeReader,
  readBincodeString,
  readBincodeBytes32Vec,
  readBincodeStringVec,
  readU32,
  readU64,
  readU128,
  decodeContractCall,
  decodeNameRegisterArgs,
  decodeHtlcCreateArgs,
  decodeNftMintArgs,
  decodeEscrowCreateArgs,
  decodeTokenTransferArgs,
  decodeVaultCreateArgs,
  bytesToHex,
  hexToBytes,
  formatTimestampDisplay,
  formatAtomsDisplay,
  getTransactionKind,
} from "../src/lib/contracts/decoders";

// Helper encoders to construct byte-exact golden test vectors
function u32le(val: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, val, true);
  return buf;
}

function u64le(val: bigint | number): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(val), true);
  return buf;
}

function u128le(val: bigint | number): Uint8Array {
  const buf = new Uint8Array(16);
  const view = new DataView(buf.buffer);
  const b = BigInt(val);
  view.setBigUint64(0, b & 0xffffffffffffffffn, true);
  view.setBigUint64(8, b >> 64n, true);
  return buf;
}

function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

function encString(s: string): Uint8Array {
  const utf8 = new TextEncoder().encode(s);
  return concat([u64le(utf8.length), utf8]);
}

function encStringVec(strings: string[]): Uint8Array {
  const parts: Uint8Array[] = [u64le(strings.length)];
  for (const s of strings) {
    parts.push(encString(s));
  }
  return concat(parts);
}

function encBytes32Vec(items: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [u64le(items.length)];
  for (const it of items) {
    parts.push(it);
  }
  return concat(parts);
}

describe("BincodeReader and Low-Level Primitives", () => {
  it("reads numerical types with little-endian byte order", () => {
    const raw = concat([
      Uint8Array.of(0x42),
      Uint8Array.of(0x34, 0x12),
      u32le(0x12345678),
      u64le(0x1122334455667788n),
      u128le(1n << 64n),
    ]);

    const r = new BincodeReader(raw);
    assert.equal(r.u8(), 0x42);
    assert.equal(r.u16(), 0x1234);
    assert.equal(readU32(r), 0x12345678);
    assert.equal(readU64(r), 0x1122334455667788n);
    assert.equal(readU128(r), 1n << 64n);
    assert.equal(r.isEof(), true);
  });

  it("handles Bincode strings correctly including UTF-8 multi-byte characters", () => {
    const text = "Kovanica DAG — 🚀";
    const encoded = encString(text);
    const r = new BincodeReader(encoded);
    const decoded = readBincodeString(r);
    assert.equal(decoded, text);
    assert.equal(r.isEof(), true);
  });

  it("decodes vectors of 32-byte pubkeys and vectors of strings", () => {
    const pk1 = new Uint8Array(32).fill(0xaa);
    const pk2 = new Uint8Array(32).fill(0xbb);
    const vecBytes = encBytes32Vec([pk1, pk2]);

    const r1 = new BincodeReader(vecBytes);
    const decodedPks = readBincodeBytes32Vec(r1);
    assert.ok(decodedPks);
    assert.equal(decodedPks.length, 2);
    assert.deepEqual(decodedPks[0], pk1);
    assert.deepEqual(decodedPks[1], pk2);

    const endpoints = ["https://relay1.kovanica.org", "https://relay2.kovanica.org"];
    const vecStrings = encStringVec(endpoints);
    const r2 = new BincodeReader(vecStrings);
    const decodedStrings = readBincodeStringVec(r2);
    assert.deepEqual(decodedStrings, endpoints);
  });
});

describe("Canonical Contract Call Payloads (Golden Vectors)", () => {
  it("decodes name_register payload matching kovanica-sdk / kovanica-playground", () => {
    const name = "alice";
    const pubkey = new Uint8Array(32).fill(0x11);
    const endpoints = ["https://relay1.kovanica.org", "https://relay2.kovanica.org"];

    const payload = concat([
      encString(name),
      pubkey,
      encStringVec(endpoints),
    ]);

    const direct = decodeNameRegisterArgs(payload);
    assert.ok(direct);
    assert.equal(direct.name, "alice");

    const result = decodeContractCall("name_register", payload);
    assert.equal(result.recognized, true);
    if (result.recognized && result.method === "name_register") {
      assert.equal(result.method, "name_register");
      assert.equal(result.params.name, "alice");
      assert.equal(result.params.pubkey, "11".repeat(32));
      assert.deepEqual(result.params.relayEndpoints, endpoints);
      assert.ok(result.params.pubkeyAddress?.startsWith("kvnc"));
    }
  });

  it("decodes htlc_create 72-byte payload matching kovanica-sdk", () => {
    const hashlock = new Uint8Array(32).fill(0xaa);
    const timelock = 1750000000n;
    const recipient = new Uint8Array(32).fill(0xbb);

    const payload = concat([hashlock, u64le(timelock), recipient]);
    assert.equal(payload.length, 72);

    const directHtlc = decodeHtlcCreateArgs(payload);
    assert.ok(directHtlc);
    assert.equal(directHtlc.timelock, 1750000000n);

    // Test with hex string input with 0x prefix
    const hexInput = `0x${bytesToHex(payload)}`;
    const result = decodeContractCall("htlc_create", hexInput);
    assert.equal(result.recognized, true);
    if (result.recognized && result.method === "htlc_create") {
      assert.equal(result.method, "htlc_create");
      assert.equal(result.params.hashlock, "aa".repeat(32));
      assert.equal(result.params.timelock, 1750000000n);
      assert.equal(result.params.recipient, "bb".repeat(32));
      assert.ok(result.params.recipientAddress?.startsWith("kvnc"));
    }
  });

  it("decodes htlc_create 88-byte fallback payload (claimer, amount, hashlock, expiry)", () => {
    const claimer = new Uint8Array(32).fill(0x11);
    const amount = 500_000_000n;
    const hashlock = new Uint8Array(32).fill(0x22);
    const expiry = 1800000000n;

    const payload = concat([claimer, u128le(amount), hashlock, u64le(expiry)]);
    assert.equal(payload.length, 88);

    const result = decodeContractCall("htlc_create", payload);
    assert.equal(result.recognized, true);
    if (result.recognized && result.method === "htlc_create") {
      assert.equal(result.params.hashlock, "22".repeat(32));
      assert.equal(result.params.recipient, "11".repeat(32));
      assert.equal(result.params.amount, 500_000_000n);
      assert.equal(result.params.timelock, 1800000000n);
    }
  });

  it("decodes nft_mint payload matching kovanica-sdk", () => {
    const collection = new Uint8Array(32).fill(0xcc);
    const to = new Uint8Array(32).fill(0xdd);
    const tokenId = 42n;
    const tokenUri = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

    const payload = concat([
      collection,
      to,
      u128le(tokenId),
      encString(tokenUri),
    ]);

    const directNft = decodeNftMintArgs(payload);
    assert.ok(directNft);
    assert.equal(directNft.tokenId, 42n);

    const result = decodeContractCall("nft_mint", payload);
    assert.equal(result.recognized, true);
    if (result.recognized && result.method === "nft_mint") {
      assert.equal(result.method, "nft_mint");
      assert.equal(result.params.collection, "cc".repeat(32));
      assert.equal(result.params.to, "dd".repeat(32));
      assert.equal(result.params.tokenId, 42n);
      assert.equal(result.params.tokenUri, tokenUri);
    }
  });

  it("decodes escrow_create 89-byte payload matching kovanica-sdk", () => {
    const p1 = new Uint8Array(32).fill(0x11);
    const p2 = new Uint8Array(32).fill(0x22);
    const threshold = 2;
    const amount = 500_000_000n;
    const deadline = 1750000000n;

    const payload = concat([
      encBytes32Vec([p1, p2]),
      Uint8Array.of(threshold),
      u64le(amount),
      u64le(deadline),
    ]);
    assert.equal(payload.length, 89);

    const directEscrow = decodeEscrowCreateArgs(payload);
    assert.ok(directEscrow);
    assert.equal(directEscrow.threshold, 2);

    const result = decodeContractCall("escrow_create", payload);
    assert.equal(result.recognized, true);
    if (result.recognized && result.method === "escrow_create") {
      assert.equal(result.method, "escrow_create");
      assert.equal(result.params.parties.length, 2);
      assert.equal(result.params.parties[0], "11".repeat(32));
      assert.equal(result.params.parties[1], "22".repeat(32));
      assert.equal(result.params.threshold, 2);
      assert.equal(result.params.amount, 500_000_000n);
      assert.equal(result.params.deadline, 1750000000n);
    }
  });

  it("decodes token_transfer 48-byte payload", () => {
    const to = new Uint8Array(32).fill(0x99);
    const amount = 1_000_000_000n;
    const payload = concat([to, u128le(amount)]);
    assert.equal(payload.length, 48);

    const directTransfer = decodeTokenTransferArgs(payload);
    assert.ok(directTransfer);
    assert.equal(directTransfer.amount, 1_000_000_000n);

    const result = decodeContractCall("token_transfer", payload);
    assert.equal(result.recognized, true);
    if (result.recognized && result.method === "token_transfer") {
      assert.equal(result.method, "token_transfer");
      assert.equal(result.params.to, "99".repeat(32));
      assert.equal(result.params.amount, 1_000_000_000n);
    }
  });

  it("decodes vault_create 40-byte and 60-byte payloads", () => {
    const owner = new Uint8Array(32).fill(0x77);
    const lockUntil = 1750000000n;

    // 40-byte layout (owner, lock_until)
    const payload40 = concat([owner, u64le(lockUntil)]);
    const directVault = decodeVaultCreateArgs(payload40);
    assert.ok(directVault);
    assert.equal(directVault.lockUntil, 1750000000n);

    const res40 = decodeContractCall("vault_create", payload40);
    assert.equal(res40.recognized, true);
    if (res40.recognized && res40.method === "vault_create") {
      assert.equal(res40.params.owner, "77".repeat(32));
      assert.equal(res40.params.lockUntil, 1750000000n);
      assert.equal(res40.params.amount, undefined);
    }

    // 60-byte layout (beneficiary, amount, 0, lock_until)
    const payload60 = concat([owner, u128le(50_000n), u32le(0), u64le(lockUntil)]);
    const res60 = decodeContractCall("vault_create", payload60);
    assert.equal(res60.recognized, true);
    if (res60.recognized && res60.method === "vault_create") {
      assert.equal(res60.params.owner, "77".repeat(32));
      assert.equal(res60.params.lockUntil, 1750000000n);
      assert.equal(res60.params.amount, 50_000n);
    }
  });
});

describe("Edge Cases, Hostile Payloads and Malformed Inputs", () => {
  it("rejects truncated buffers safely without throwing", () => {
    const validHtlc = concat([new Uint8Array(32).fill(1), u64le(100n), new Uint8Array(32).fill(2)]);

    // Truncate at various lengths
    for (const len of [0, 1, 31, 32, 39, 40, 71]) {
      const truncated = validHtlc.subarray(0, len);
      const res = decodeContractCall("htlc_create", truncated);
      assert.equal(res.recognized, false);
      assert.ok(res.rawHex !== undefined);
    }
  });

  it("rejects trailing garbage strictly", () => {
    const validHtlc = concat([new Uint8Array(32).fill(1), u64le(100n), new Uint8Array(32).fill(2)]);
    const withGarbage = concat([validHtlc, Uint8Array.of(0xff, 0xee)]);

    const res = decodeContractCall("htlc_create", withGarbage);
    assert.equal(res.recognized, false);
  });

  it("rejects invalid UTF-8 in string fields", () => {
    // 0xFF, 0xC0 are invalid UTF-8 sequences
    const invalidUtf8 = new Uint8Array([0xff, 0xc0]);
    const payload = concat([
      u64le(invalidUtf8.length),
      invalidUtf8,
      new Uint8Array(32),
      encStringVec([]),
    ]);

    const res = decodeContractCall("name_register", payload);
    assert.equal(res.recognized, false);
  });

  it("rejects oversized vector counts safely without OOM or hanging", () => {
    // 64-bit integer claiming 0x7fffffffffffffffn items
    const hugeCount = concat([
      u64le(0x7fffffffffffffffn),
      new Uint8Array(32),
    ]);

    const res = decodeContractCall("escrow_create", hugeCount);
    assert.equal(res.recognized, false);
  });

  it("handles malformed hex strings gracefully", () => {
    const resOdd = decodeContractCall("name_register", "0xabc");
    assert.equal(resOdd.recognized, false);

    const resNonHex = decodeContractCall("name_register", "not_hex_at_all");
    assert.equal(resNonHex.recognized, false);
  });

  it("returns recognized: false for unknown method names", () => {
    const res = decodeContractCall("unknown_method_xyz", new Uint8Array(32));
    assert.equal(res.recognized, false);
    assert.ok(res.error?.includes("unknown_method_xyz"));
  });
});

describe("Formatters for UI Presentation", () => {
  it("formats timestamps into readable date strings", () => {
    const formatted = formatTimestampDisplay(1750000000n);
    assert.ok(formatted.includes("2025"));
    assert.ok(formatted.includes("1750000000"));
  });

  it("formats atoms to human-readable KVNC units", () => {
    assert.equal(formatAtomsDisplay(0n), "0");
    assert.equal(formatAtomsDisplay(1_000_000_000n), "1");
    assert.equal(formatAtomsDisplay(1_500_000_000n), "1.5");
    assert.equal(formatAtomsDisplay(42n), "0.000000042");
    assert.equal(formatAtomsDisplay("5000000000"), "5");
  });

  it("detects transaction kinds accurately", () => {
    assert.equal(getTransactionKind({ coinbase: true }), "Coinbase");
    assert.equal(getTransactionKind({ coinbase: false, kind: "Call" }), "Call");
    assert.equal(getTransactionKind({ coinbase: false, kind: { type: "call" } }), "Call");
    assert.equal(getTransactionKind({ coinbase: false, method: "nft_mint" }), "Call");
    assert.equal(getTransactionKind({ coinbase: false, kind: "Deploy" }), "Deploy");
    assert.equal(getTransactionKind({ coinbase: false, kind: "Transfer" }), "Transfer");
    assert.equal(getTransactionKind({ coinbase: false }), "Transfer");
  });

  it("converts hex to bytes and handles null for invalid hex", () => {
    assert.deepEqual(hexToBytes(""), new Uint8Array(0));
    assert.deepEqual(hexToBytes("0x1122"), Uint8Array.of(0x11, 0x22));
    assert.equal(hexToBytes("123"), null);
    assert.equal(hexToBytes("zz"), null);
  });
});
