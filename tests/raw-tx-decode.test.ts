import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CALL_TX_VARIANT,
  MAX_WIRE_TX_BYTES,
  decodeWireCallTxHex,
} from "../src/lib/explorer/raw-tx-decode";
import {
  buildHtlcCreateCall,
  buildNameRegisterCall,
  buildTokenTransferCall,
  bytesToHex,
  concatBytes,
  u32le,
  u64le,
  u128le,
} from "../src/lib/contracts/decoders";
import { decodeAddress, encodeAddress } from "../src/lib/wallet/address";

function buildWireCallTxBytes(opts: {
  sender?: Uint8Array;
  nonce?: bigint | number;
  fee?: bigint | number;
  variant?: number;
  contract?: Uint8Array;
  args?: Uint8Array;
  gasLimit?: bigint | number;
  sigLen?: bigint | number;
  signature?: Uint8Array;
  trailing?: Uint8Array;
}): Uint8Array {
  const sender = opts.sender ?? new Uint8Array(32).fill(0x11);
  const nonce = opts.nonce ?? 7n;
  const fee = opts.fee ?? 250_000n;
  const variant = opts.variant ?? CALL_TX_VARIANT;
  const contract = opts.contract ?? new Uint8Array(32).fill(0x22);
  const args = opts.args ?? new Uint8Array(0);
  const gasLimit = opts.gasLimit ?? 1_500_000n;
  const signature = opts.signature ?? new Uint8Array(64).fill(0xab);
  const sigLen = opts.sigLen ?? BigInt(signature.length);

  const parts: Uint8Array[] = [
    sender,
    u64le(nonce),
    u128le(fee),
    u32le(variant),
    contract,
    u64le(args.length),
    args,
    u64le(gasLimit),
    u64le(sigLen),
    signature,
  ];
  if (opts.trailing) {
    parts.push(opts.trailing);
  }
  return concatBytes(parts);
}

describe("decodeWireCallTxHex — valid Call wire transactions", () => {
  it("decodes bare hex and 0x-prefixed Call wire hex identically", () => {
    const sender = new Uint8Array(32).fill(0xaa);
    const contract = new Uint8Array(32).fill(0xbb);
    const args = Uint8Array.of(0xde, 0xad, 0xbe, 0xef);
    const sig = new Uint8Array(64).fill(0xcc);

    const raw = buildWireCallTxBytes({
      sender,
      nonce: 42n,
      fee: 1_500_000_000n,
      contract,
      args,
      gasLimit: 2_000_000n,
      signature: sig,
    });

    const bareHex = bytesToHex(raw);
    const prefixedHex = `0x${bareHex}`;

    const resBare = decodeWireCallTxHex(bareHex);
    const resPrefixed = decodeWireCallTxHex(`  ${prefixedHex.toUpperCase()}  `);

    assert.equal(resBare.ok, true);
    assert.equal(resPrefixed.ok, true);
    if (!resBare.ok || !resPrefixed.ok) return;

    assert.deepEqual(resBare.tx, resPrefixed.tx);
    assert.equal(resBare.tx.senderHex, "aa".repeat(32));
    assert.equal(resBare.tx.contractHex, "bb".repeat(32));
    assert.equal(resBare.tx.nonce, 42n);
    assert.equal(resBare.tx.fee, 1_500_000_000n);
    assert.equal(resBare.tx.argsHex, "deadbeef");
    assert.equal(resBare.tx.argsLength, 4);
    assert.equal(resBare.tx.gasLimit, 2_000_000n);
    assert.equal(resBare.tx.signatureHex, "cc".repeat(64));
    assert.equal(resBare.tx.wireSizeBytes, raw.length);
    assert.equal(resBare.tx.decodedCallArgs, undefined);
  });

  it("formats sender and contract as canonical PRO-21 kvnc...dag addresses", () => {
    const sender = new Uint8Array(32);
    const contract = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      sender[i] = i + 1;
      contract[i] = 255 - i;
    }

    const raw = buildWireCallTxBytes({ sender, contract });
    const res = decodeWireCallTxHex(bytesToHex(raw));

    assert.equal(res.ok, true);
    if (!res.ok) return;

    const expectedSenderAddr = encodeAddress(sender);
    const expectedContractAddr = encodeAddress(contract);

    assert.equal(res.tx.senderAddress, expectedSenderAddr);
    assert.equal(res.tx.contractAddress, expectedContractAddr);
    assert.ok(res.tx.senderAddress.startsWith("kvnc"));
    assert.ok(res.tx.senderAddress.endsWith("dag"));
    assert.equal(res.tx.senderAddress.length, 64);
    assert.deepEqual(decodeAddress(res.tx.senderAddress), sender);
    assert.deepEqual(decodeAddress(res.tx.contractAddress), contract);
  });

  it("handles empty args and large u64/u128 numeric fields without precision loss", () => {
    const maxSafePlus = BigInt(Number.MAX_SAFE_INTEGER) + 123456n;
    const hugeFee = (1n << 96n) + 999_999_999n;
    const raw = buildWireCallTxBytes({
      nonce: maxSafePlus,
      fee: hugeFee,
      args: new Uint8Array(0),
      gasLimit: maxSafePlus + 1n,
    });

    const res = decodeWireCallTxHex(`0x${bytesToHex(raw)}`);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.tx.nonce, maxSafePlus);
    assert.equal(res.tx.fee, hugeFee);
    assert.equal(res.tx.gasLimit, maxSafePlus + 1n);
    assert.equal(res.tx.argsLength, 0);
    assert.equal(res.tx.argsHex, "");
    assert.equal(res.tx.wireSizeBytes, 180);
  });

  it("optionally decodes recognized contract call args (name_register, token_transfer, htlc_create)", () => {
    // name_register
    const pubkey = new Uint8Array(32).fill(0x33);
    const nameArgs = buildNameRegisterCall("alice", pubkey, ["https://relay.kovanica.online"]);
    const resName = decodeWireCallTxHex(bytesToHex(buildWireCallTxBytes({ args: nameArgs })));
    assert.equal(resName.ok, true);
    if (resName.ok) {
      assert.equal(resName.tx.decodedCallArgs?.method, "name_register");
      if (resName.tx.decodedCallArgs?.method === "name_register") {
        assert.equal(resName.tx.decodedCallArgs.params.name, "alice");
        assert.deepEqual(resName.tx.decodedCallArgs.params.relayEndpoints, [
          "https://relay.kovanica.online",
        ]);
      }
    }

    // token_transfer
    const recipient = new Uint8Array(32).fill(0x44);
    const transferArgs = buildTokenTransferCall(recipient, 5_000_000_000n);
    const resTransfer = decodeWireCallTxHex(
      bytesToHex(buildWireCallTxBytes({ args: transferArgs })),
    );
    assert.equal(resTransfer.ok, true);
    if (resTransfer.ok) {
      assert.equal(resTransfer.tx.decodedCallArgs?.method, "token_transfer");
      if (resTransfer.tx.decodedCallArgs?.method === "token_transfer") {
        assert.equal(resTransfer.tx.decodedCallArgs.params.amount, 5_000_000_000n);
        assert.equal(resTransfer.tx.decodedCallArgs.params.to, "44".repeat(32));
      }
    }

    // htlc_create
    const hashlock = new Uint8Array(32).fill(0x55);
    const htlcArgs = buildHtlcCreateCall(hashlock, 1750000000n, recipient);
    const resHtlc = decodeWireCallTxHex(bytesToHex(buildWireCallTxBytes({ args: htlcArgs })));
    assert.equal(resHtlc.ok, true);
    if (resHtlc.ok) {
      assert.equal(resHtlc.tx.decodedCallArgs?.method, "htlc_create");
    }
  });
});

describe("decodeWireCallTxHex — rejection & error handling", () => {
  it("rejects non-Call transaction variant discriminants", () => {
    for (const variant of [0, 1, 2, 5, 7, 999]) {
      const raw = buildWireCallTxBytes({ variant });
      const res = decodeWireCallTxHex(bytesToHex(raw));
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.match(res.error, /variant discriminant/i);
        assert.match(res.error, new RegExp(String(variant)));
      }
    }
  });

  it("rejects truncated wire buffers at every structural boundary", () => {
    const valid = buildWireCallTxBytes({ args: Uint8Array.of(1, 2, 3, 4) });
    const cutPoints = [1, 31, 32, 39, 55, 59, 60, 91, 99, 102, 104, 111, 119, 120, valid.length - 1];

    for (const len of cutPoints) {
      const truncated = valid.subarray(0, len);
      const res = decodeWireCallTxHex(bytesToHex(truncated));
      assert.equal(res.ok, false, `Expected truncation at length ${len} to fail`);
      if (!res.ok) {
        assert.match(res.error, /truncated/i);
      }
    }
  });

  it("rejects trailing bytes after the 64-byte signature", () => {
    const withTrailing = buildWireCallTxBytes({ trailing: Uint8Array.of(0x00) });
    const res1 = decodeWireCallTxHex(bytesToHex(withTrailing));
    assert.equal(res1.ok, false);
    if (!res1.ok) {
      assert.match(res1.error, /trailing byte/i);
    }

    const withMoreTrailing = buildWireCallTxBytes({ trailing: Uint8Array.of(0xde, 0xad, 0xbe) });
    const res3 = decodeWireCallTxHex(bytesToHex(withMoreTrailing));
    assert.equal(res3.ok, false);
    if (!res3.ok) {
      assert.match(res3.error, /3 unexpected trailing byte/i);
    }
  });

  it("rejects invalid Ed25519 signature lengths", () => {
    const badSigLen = buildWireCallTxBytes({ sigLen: 63n, signature: new Uint8Array(63) });
    const res = decodeWireCallTxHex(bytesToHex(badSigLen));
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /signature length/i);
    }
  });

  it("rejects invalid hex strings (empty, 0x-only, odd length, non-hex chars)", () => {
    const cases = ["", "   ", "0x", "0X", "abc", "0x123", "zz1122", "0x1234gg"];
    for (const input of cases) {
      const res = decodeWireCallTxHex(input);
      assert.equal(res.ok, false, `Expected invalid hex "${input}" to fail`);
    }
  });

  it("rejects oversized wire transactions exceeding MAX_WIRE_TX_BYTES", () => {
    const oversizedHex = "00".repeat(MAX_WIRE_TX_BYTES + 1);
    const res = decodeWireCallTxHex(oversizedHex);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /exceeds maximum allowed size/i);
    }
  });
});
