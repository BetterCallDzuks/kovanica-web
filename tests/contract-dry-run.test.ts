import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_PRESETS,
  buildContractCallRequest,
  decodeContractOutput,
  decodeNameEntry,
  encodeNameEntry,
  encodePresetArgs,
  getContractPreset,
  normalizeHexData,
  parseAddressBytes32,
  parseContractError,
  parseUintQuantity,
  type ContractCallResponse,
} from "../src/lib/contracts/dry-run";
import {
  bytesToHex,
  decodeContractCall,
  encodeBincodeString,
  u128le,
  u64le,
} from "../src/lib/contracts/decoders";
import { encodeAddress } from "../src/lib/wallet/address";
import { dispatchApi } from "../src/lib/api/dispatch.server";

const SAMPLE_HEX_A = "11".repeat(32);
const SAMPLE_HEX_B = "22".repeat(32);
const SAMPLE_HEX_C = "33".repeat(32);
const SAMPLE_ADDR_A = encodeAddress(new Uint8Array(32).fill(0x11));
const SAMPLE_ADDR_B = encodeAddress(new Uint8Array(32).fill(0x22));

describe("Contract Dry-Run Presets & Encoding", () => {
  it("exposes built-in Kovanica presets including name, token, nft, escrow, htlc, vault, and custom", () => {
    const ids = CONTRACT_PRESETS.map((p) => p.id);
    assert.deepEqual(ids, [
      "name_resolve",
      "name_register",
      "token_transfer",
      "nft_mint",
      "escrow_create",
      "htlc_create",
      "vault_create",
      "custom",
    ]);
    assert.equal(getContractPreset("name_resolve").entry, "name_resolve");
  });

  it("encodes name_resolve into canonical Bincode string", () => {
    const res = encodePresetArgs("name_resolve", { name: "alice" });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.entry, "name_resolve");
    assert.equal(res.dataHex, `0x${bytesToHex(encodeBincodeString("alice"))}`);
    assert.equal(res.byteLength, 8 + 5);
  });

  it("encodes name_register and round-trips through decodeContractCall", () => {
    const res = encodePresetArgs("name_register", {
      name: "bob",
      pubkey: SAMPLE_ADDR_A,
      relayEndpoints: "https://relay1.kovanica.online, https://relay2.kovanica.online",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const decoded = decodeContractCall(res.entry, res.dataHex);
    assert.equal(decoded.recognized, true);
    if (!decoded.recognized || decoded.method !== "name_register") return;
    assert.equal(decoded.params.name, "bob");
    assert.equal(decoded.params.pubkey, SAMPLE_HEX_A);
    assert.deepEqual(decoded.params.relayEndpoints, [
      "https://relay1.kovanica.online",
      "https://relay2.kovanica.online",
    ]);
  });

  it("encodes token_transfer and round-trips through decodeContractCall", () => {
    const res = encodePresetArgs("token_transfer", {
      to: SAMPLE_ADDR_B,
      amount: "2500000000",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.byteLength, 48);
    const decoded = decodeContractCall("token_transfer", res.dataHex);
    assert.equal(decoded.recognized, true);
    if (!decoded.recognized || decoded.method !== "token_transfer") return;
    assert.equal(decoded.params.to, SAMPLE_HEX_B);
    assert.equal(decoded.params.amount, 2_500_000_000n);
  });

  it("encodes nft_mint and round-trips through decodeContractCall", () => {
    const res = encodePresetArgs("nft_mint", {
      collection: SAMPLE_HEX_A,
      to: SAMPLE_ADDR_B,
      tokenId: "42",
      tokenUri: "ipfs://QmNft42",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const decoded = decodeContractCall("nft_mint", res.dataHex);
    assert.equal(decoded.recognized, true);
    if (!decoded.recognized || decoded.method !== "nft_mint") return;
    assert.equal(decoded.params.collection, SAMPLE_HEX_A);
    assert.equal(decoded.params.to, SAMPLE_HEX_B);
    assert.equal(decoded.params.tokenId, 42n);
    assert.equal(decoded.params.tokenUri, "ipfs://QmNft42");
  });

  it("encodes escrow_create and validates threshold bounds", () => {
    const bad = encodePresetArgs("escrow_create", {
      parties: SAMPLE_ADDR_A,
      threshold: "2",
      amount: "1000",
      deadline: "1800000000",
    });
    assert.equal(bad.ok, false);

    const good = encodePresetArgs("escrow_create", {
      parties: `${SAMPLE_ADDR_A}, ${SAMPLE_ADDR_B}`,
      threshold: "2",
      amount: "5000000000",
      deadline: "1800000000",
    });
    assert.equal(good.ok, true);
    if (!good.ok) return;
    const decoded = decodeContractCall("escrow_create", good.dataHex);
    assert.equal(decoded.recognized, true);
    if (!decoded.recognized || decoded.method !== "escrow_create") return;
    assert.equal(decoded.params.threshold, 2);
    assert.equal(decoded.params.amount, 5_000_000_000n);
    assert.equal(decoded.params.parties.length, 2);
  });

  it("encodes htlc_create and vault_create and round-trips through decodeContractCall", () => {
    const htlc = encodePresetArgs("htlc_create", {
      hashlock: SAMPLE_HEX_C,
      timelock: "1800000000",
      recipient: SAMPLE_ADDR_A,
    });
    assert.equal(htlc.ok, true);
    if (htlc.ok) {
      const dec = decodeContractCall("htlc_create", htlc.dataHex);
      assert.equal(dec.recognized, true);
    }

    const vault = encodePresetArgs("vault_create", {
      owner: SAMPLE_ADDR_B,
      lockUntil: "1900000000",
    });
    assert.equal(vault.ok, true);
    if (vault.ok) {
      const dec = decodeContractCall("vault_create", vault.dataHex);
      assert.equal(dec.recognized, true);
    }
  });

  it("validates custom raw hex payloads", () => {
    const empty = encodePresetArgs("custom", { entry: "call", data: "" });
    assert.equal(empty.ok, true);
    if (empty.ok) {
      assert.equal(empty.dataHex, "0x");
      assert.equal(empty.byteLength, 0);
    }

    const invalid = encodePresetArgs("custom", { entry: "call", data: "0xabc" });
    assert.equal(invalid.ok, false);
  });
});

describe("Request Validation & Primitives", () => {
  it("parses canonical kvnc...dag, 64-hex, and 0x-prefixed hex addresses", () => {
    assert.equal(parseAddressBytes32(SAMPLE_ADDR_A)?.length, 32);
    assert.equal(parseAddressBytes32(SAMPLE_HEX_A)?.length, 32);
    assert.equal(parseAddressBytes32(`0x${SAMPLE_HEX_A}`)?.length, 32);
    assert.equal(parseAddressBytes32("not-an-address"), null);
  });

  it("parses decimal and 0x hex uint quantities safely", () => {
    const dec = parseUintQuantity("5000000", "Gas");
    assert.equal(dec.ok, true);
    if (dec.ok) assert.equal(dec.hex, "0x4c4b40");

    const hex = parseUintQuantity("0x5208", "Gas");
    assert.equal(hex.ok, true);
    if (hex.ok) assert.equal(hex.value, 21000n);

    const neg = parseUintQuantity("-1", "Gas");
    assert.equal(neg.ok, false);
  });

  it("normalizes hex data payloads", () => {
    const res = normalizeHexData("DEADBEEF");
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.hex, "0xdeadbeef");
      assert.equal(res.byteLength, 4);
    }
    assert.equal(normalizeHexData("0xzz").ok, false);
  });

  it("builds canonical ContractCallRequest and rejects invalid fields", () => {
    const ok = buildContractCallRequest({
      to: SAMPLE_HEX_A,
      from: SAMPLE_HEX_B,
      entry: "name_resolve",
      data: "0x0500000000000000616c696365",
      value: "1000",
      gas: "0x7a120",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.call.to, SAMPLE_ADDR_A);
      assert.equal(ok.call.from, SAMPLE_ADDR_B);
      assert.equal(ok.call.value, "0x3e8");
      assert.equal(ok.call.gas, "0x7a120");
    }

    assert.equal(buildContractCallRequest({ to: "" }).ok, false);
    assert.equal(buildContractCallRequest({ to: "bad-addr" }).ok, false);
    assert.equal(buildContractCallRequest({ to: SAMPLE_ADDR_A, from: "bad" }).ok, false);
    assert.equal(
      buildContractCallRequest({ to: SAMPLE_ADDR_A, entry: "bad entry!" }).ok,
      false,
    );
  });
});

describe("Contract Output Decoding & Error Classification", () => {
  it("decodes empty output as unit ()", () => {
    const out = decodeContractOutput("0x");
    assert.equal(out.primary.kind, "empty");
    assert.equal(out.byteLength, 0);
  });

  it("decodes Bincode NameEntry output from name_resolve", () => {
    const owner = new Uint8Array(32).fill(0x11);
    const pubkey = new Uint8Array(32).fill(0xaa);
    const encoded = encodeNameEntry(owner, pubkey, ["https://relay.kovanica.online"]);
    const direct = decodeNameEntry(encoded);
    assert.ok(direct);
    assert.equal(direct.ownerAddress, SAMPLE_ADDR_A);
    assert.deepEqual(direct.relayEndpoints, ["https://relay.kovanica.online"]);

    const out = decodeContractOutput(`0x${bytesToHex(encoded)}`, "name_resolve");
    assert.equal(out.primary.kind, "name_entry");
    if (out.primary.kind === "name_entry") {
      assert.equal(out.primary.value.ownerHex, SAMPLE_HEX_A);
      assert.equal(out.primary.value.relayEndpoints[0], "https://relay.kovanica.online");
    }
  });

  it("decodes u64, u128, 32-byte address, bincode string, JSON, and raw binary outputs", () => {
    const u64Out = decodeContractOutput(`0x${bytesToHex(u64le(123_456_789n))}`);
    assert.equal(u64Out.primary.kind, "u64");
    if (u64Out.primary.kind === "u64") assert.equal(u64Out.primary.value, "123456789");

    const u128Out = decodeContractOutput(`0x${bytesToHex(u128le(9_999_999_999_999n))}`);
    assert.equal(u128Out.primary.kind, "u128");
    if (u128Out.primary.kind === "u128") assert.equal(u128Out.primary.value, "9999999999999");

    const addrOut = decodeContractOutput(`0x${SAMPLE_HEX_A}`);
    assert.equal(addrOut.primary.kind, "address");
    if (addrOut.primary.kind === "address") assert.equal(addrOut.primary.canonical, SAMPLE_ADDR_A);

    const bincodeStr = decodeContractOutput(`0x${bytesToHex(encodeBincodeString("kovanica"))}`);
    assert.equal(bincodeStr.primary.kind, "bincode_string");
    if (bincodeStr.primary.kind === "bincode_string") {
      assert.equal(bincodeStr.primary.value, "kovanica");
    }

    const jsonBytes = new TextEncoder().encode('{"ok":true,"supply":42}');
    const jsonOut = decodeContractOutput(`0x${bytesToHex(jsonBytes)}`);
    assert.equal(jsonOut.primary.kind, "json");

    const rawOut = decodeContractOutput("0xff00fe01");
    assert.equal(rawOut.primary.kind, "raw");
    assert.equal(rawOut.byteLength, 4);
  });

  it("classifies Wasmi revert codes, out-of-gas, validation, and network errors", () => {
    const notFound = parseContractError("Execution reverted or failed: code -5", true);
    assert.equal(notFound.category, "revert");
    assert.equal(notFound.contractErrorName, "NotFound (code 4)");

    const oom = parseContractError("Execution reverted: out of gas / fuel exhausted", true);
    assert.equal(oom.category, "revert");
    assert.equal(oom.contractErrorName, "OutOfGas (code 8)");

    const net = parseContractError("RPC HTTP 503 stalled", false);
    assert.equal(net.category, "network");

    const val = parseContractError("Invalid params: invalid hex payload", false);
    assert.equal(val.category, "validation");
  });
});

describe("POST /api/contract_call dispatchApi integration", () => {
  it("executes local dry-run name_resolve for 'alice' and decodes NameEntry", async () => {
    const encoded = encodePresetArgs("name_resolve", { name: "alice" });
    assert.equal(encoded.ok, true);
    if (!encoded.ok) return;

    const req = new Request("http://localhost:8080/api/contract_call?source=local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: SAMPLE_HEX_A,
        entry: encoded.entry,
        data: encoded.dataHex,
      }),
    });

    const res = await dispatchApi(req);
    assert.equal(res.status, 200);
    const body = (await res.json()) as ContractCallResponse;
    assert.equal(body.ok, true);
    if (!body.ok) return;
    assert.equal(body.source, "local");
    assert.equal(body.rpcMethod, "kovanica_call");
    assert.ok(body.gasUsed !== null && body.gasUsed > 21_000);

    const decoded = decodeContractOutput(body.outputHex, "name_resolve");
    assert.equal(decoded.primary.kind, "name_entry");
    if (decoded.primary.kind === "name_entry") {
      assert.equal(decoded.primary.value.relayEndpoints.length, 2);
    }
  });

  it("returns structured revert diagnostics for unknown name in local dry-run", async () => {
    const encoded = encodePresetArgs("name_resolve", { name: "nonexistent-name" });
    assert.equal(encoded.ok, true);
    if (!encoded.ok) return;

    const req = new Request("http://localhost:8080/api/contract_call?source=local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: SAMPLE_HEX_A,
        entry: encoded.entry,
        data: encoded.dataHex,
      }),
    });

    const res = await dispatchApi(req);
    assert.equal(res.status, 200);
    const body = (await res.json()) as ContractCallResponse;
    assert.equal(body.ok, false);
    if (body.ok) return;
    assert.equal(body.reverted, true);
    assert.match(body.error, /NotFound/i);
  });

  it("blocks contract_call POST on mainnet prior to genesis launch", async () => {
    const req = new Request("http://localhost:8080/api/contract_call?source=mainnet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: SAMPLE_HEX_A }),
    });
    const res = await dispatchApi(req);
    assert.equal(res.status, 403);
  });
});
