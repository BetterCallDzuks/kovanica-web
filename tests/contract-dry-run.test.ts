import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_PRESETS,
  STORAGE_SLOT_PRESETS,
  buildContractCallRequest,
  buildContractCurlSnippet,
  buildContractInspectorDeepLink,
  buildContractSdkSnippet,
  buildContractStorageRequest,
  computeStorageSlotHex,
  decodeContractOutput,
  decodeContractStorageValue,
  decodeNameEntry,
  derivePresetStorageSlot,
  encodeEscrowStorage,
  encodeHtlcStorage,
  encodeMultisigStorage,
  encodeNameEntry,
  encodePresetArgs,
  encodeTokenMetadataStorage,
  encodeVaultStorage,
  getContractPreset,
  isContractPresetId,
  normalizeHexData,
  parseAddressBytes32,
  parseContractError,
  parseContractInspectorDeepLink,
  parseUintQuantity,
  type ContractCallResponse,
  type ContractStorageResponse,
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

describe("Contract Inspector Shareable Deep-Links & Developer Snippets", () => {
  it("serializes and parses deep-link URLs round-trip with JSON and query-param args", () => {
    const url = buildContractInspectorDeepLink({
      baseUrl: "https://testnet.kovanica.online",
      contractAddress: SAMPLE_ADDR_A,
      presetId: "name_resolve",
      fields: { name: "alice", ignoredKey: "drop-me" },
    });
    assert.ok(url.startsWith("https://testnet.kovanica.online/explorer?"));
    assert.ok(url.includes("tab=contracts"));
    assert.ok(url.includes("preset=name_resolve"));

    const parsed = parseContractInspectorDeepLink(new URL(url).search);
    assert.equal(parsed.isContractsTab, true);
    assert.equal(parsed.contractAddress, SAMPLE_ADDR_A);
    assert.equal(parsed.presetId, "name_resolve");
    assert.deepEqual(parsed.fields, { name: "alice" });

    // Also supports URLSearchParams-formatted args (`args=name=bob`)
    const fromSubQuery = parseContractInspectorDeepLink(
      `?tab=contracts&contract=${SAMPLE_HEX_B}&preset=name_resolve&args=name%3Dbob`,
    );
    assert.equal(fromSubQuery.isContractsTab, true);
    assert.equal(fromSubQuery.contractAddress, SAMPLE_HEX_B);
    assert.equal(fromSubQuery.presetId, "name_resolve");
    assert.deepEqual(fromSubQuery.fields, { name: "bob" });
  });

  it("gracefully ignores invalid presets, bad addresses, unknown fields, and oversized query params", () => {
    assert.equal(isContractPresetId("name_resolve"), true);
    assert.equal(isContractPresetId("unknown_preset"), false);

    const invalid = parseContractInspectorDeepLink(
      "?tab=contracts&contract=not-an-address&preset=not_a_preset&args=%7Bbroken-json",
    );
    assert.equal(invalid.isContractsTab, true);
    assert.equal(invalid.contractAddress, null);
    assert.equal(invalid.presetId, null);
    assert.deepEqual(invalid.fields, {});

    // Oversized query string (> 2048 chars) is rejected cleanly
    const hugeQuery = `?tab=contracts&preset=name_resolve&args=${"a".repeat(3000)}`;
    const oversized = parseContractInspectorDeepLink(hugeQuery);
    assert.equal(oversized.isContractsTab, false);
    assert.equal(oversized.contractAddress, null);
    assert.equal(oversized.presetId, null);
    assert.deepEqual(oversized.fields, {});

    // Oversized field value (> 512 chars) is ignored
    const hugeFieldJson = encodeURIComponent(JSON.stringify({ name: "x".repeat(600) }));
    const oversizedField = parseContractInspectorDeepLink(
      `?tab=contracts&preset=name_resolve&args=${hugeFieldJson}`,
    );
    assert.equal(oversizedField.isContractsTab, true);
    assert.deepEqual(oversizedField.fields, {});
  });

  it("generates ready-to-run JSON-RPC cURL commands with encoded Bincode payload", () => {
    const curl = buildContractCurlSnippet({
      rpcUrl: "https://testnet.kovanica.online/rpc",
      contractAddress: SAMPLE_HEX_A,
      presetId: "name_resolve",
      fields: { name: "alice" },
      from: SAMPLE_HEX_B,
      value: "1000",
      gas: "50000",
    });

    assert.match(curl, /^curl -X POST 'https:\/\/testnet\.kovanica\.online\/rpc'/);
    assert.ok(curl.includes(`"method":"kovanica_call"`));
    assert.ok(curl.includes(`"entry":"name_resolve"`));
    assert.ok(curl.includes(`"to":"${SAMPLE_ADDR_A}"`));
    assert.ok(curl.includes(`"from":"${SAMPLE_ADDR_B}"`));
    assert.ok(curl.includes(`"data":"0x0500000000000000616c696365"`));
    assert.ok(curl.includes(`"value":"0x3e8"`));
    assert.ok(curl.includes(`"gas":"0xc350"`));
  });

  it("generates ready-to-run TypeScript kovanica-sdk snippets using KovanicaClient and estimateAndBuildCall", () => {
    const sdk = buildContractSdkSnippet({
      rpcUrl: "https://testnet.kovanica.online/rpc",
      contractAddress: SAMPLE_HEX_A,
      presetId: "token_transfer",
      fields: { to: SAMPLE_ADDR_B, amount: "2500000000" },
    });

    assert.ok(sdk.includes(`import { KovanicaClient, estimateAndBuildCall } from "kovanica-sdk";`));
    assert.ok(sdk.includes(`new KovanicaClient({ rpcUrl: "https://testnet.kovanica.online/rpc" })`));
    assert.ok(sdk.includes(`to: "${SAMPLE_ADDR_A}"`));
    assert.ok(sdk.includes(`entry: "token_transfer"`));
    assert.ok(sdk.includes(`await client.call(callRequest)`));
    assert.ok(sdk.includes(`await estimateAndBuildCall(client, callRequest)`));
  });
});

describe("Contract Storage Slot Derivation & Bincode State Reader", () => {
  it("computes deterministic BLAKE3 storage slots for Kovanica key conventions and accepts raw 32-byte hex slots", () => {
    assert.ok(STORAGE_SLOT_PRESETS.length >= 7);

    const nameSlot = derivePresetStorageSlot("name", "alice");
    assert.equal(nameSlot.ok, true);
    if (nameSlot.ok) {
      assert.equal(nameSlot.rawKey, "name:alice");
      assert.equal(nameSlot.derivation, "blake3");
      assert.match(nameSlot.slotHex, /^0x[0-9a-f]{64}$/);
    }

    const tokenSlot = derivePresetStorageSlot("token_meta", "");
    assert.equal(tokenSlot.ok, true);
    if (tokenSlot.ok) {
      assert.equal(tokenSlot.rawKey, "token:meta");
      assert.equal(tokenSlot.derivation, "blake3");
    }

    const rawHexSlot = computeStorageSlotHex(`0x${SAMPLE_HEX_A}`);
    assert.equal(rawHexSlot.ok, true);
    if (rawHexSlot.ok) {
      assert.equal(rawHexSlot.slotHex, `0x${SAMPLE_HEX_A}`);
      assert.equal(rawHexSlot.derivation, "raw32");
      assert.equal(rawHexSlot.rawKey, null);
    }

    // Invalid odd/short 0x hex slot is rejected
    const badHexSlot = computeStorageSlotHex("0x1234");
    assert.equal(badHexSlot.ok, false);
  });

  it("decodes empty storage slots (0x and 32 zero bytes) and Bincode NameEntry, TokenMetadata, Escrow, HTLC, Vault, and Multisig records", () => {
    const empty0x = decodeContractStorageValue("0x");
    assert.equal(empty0x.isEmpty, true);
    assert.equal(empty0x.record.kind, "empty");

    const zero32 = decodeContractStorageValue(`0x${"00".repeat(32)}`);
    assert.equal(zero32.isEmpty, true);
    assert.equal(zero32.isZeroBytes32, true);
    assert.equal(zero32.record.kind, "empty");

    // NameEntry
    const nameBytes = encodeNameEntry(
      new Uint8Array(32).fill(0x11),
      new Uint8Array(32).fill(0xaa),
      ["https://relay1.kovanica.online"],
    );
    const decName = decodeContractStorageValue(`0x${bytesToHex(nameBytes)}`, "name_entry");
    assert.equal(decName.record.kind, "name_entry");
    if (decName.record.kind === "name_entry") {
      assert.equal(decName.record.value.ownerAddress, SAMPLE_ADDR_A);
      assert.deepEqual(decName.record.value.relayEndpoints, ["https://relay1.kovanica.online"]);
    }

    // TokenMetadata
    const tokenBytes = encodeTokenMetadataStorage({
      name: "Kovanica Gold",
      symbol: "KGLD",
      decimals: 9,
      totalSupply: 500_000_000_000n,
      owner: new Uint8Array(32).fill(0x11),
      paused: false,
    });
    const decToken = decodeContractStorageValue(`0x${bytesToHex(tokenBytes)}`, "token_meta");
    assert.equal(decToken.record.kind, "token_meta");
    if (decToken.record.kind === "token_meta") {
      assert.equal(decToken.record.value.name, "Kovanica Gold");
      assert.equal(decToken.record.value.symbol, "KGLD");
      assert.equal(decToken.record.value.decimals, 9);
      assert.equal(decToken.record.value.totalSupply, "500000000000");
      assert.equal(decToken.record.value.paused, false);
    }

    // Escrow
    const escrowBytes = encodeEscrowStorage(
      [new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)],
      2,
      5_000_000_000n,
      1_800_000_000n,
    );
    const decEscrow = decodeContractStorageValue(`0x${bytesToHex(escrowBytes)}`, "escrow");
    assert.equal(decEscrow.record.kind, "escrow");
    if (decEscrow.record.kind === "escrow") {
      assert.equal(decEscrow.record.value.threshold, 2);
      assert.equal(decEscrow.record.value.amount, "5000000000");
    }

    // HTLC
    const htlcBytes = encodeHtlcStorage(
      new Uint8Array(32).fill(0x33),
      1_800_000_000n,
      new Uint8Array(32).fill(0x11),
    );
    const decHtlc = decodeContractStorageValue(`0x${bytesToHex(htlcBytes)}`, "htlc");
    assert.equal(decHtlc.record.kind, "htlc");
    if (decHtlc.record.kind === "htlc") {
      assert.equal(decHtlc.record.value.hashlockHex, SAMPLE_HEX_C);
      assert.equal(decHtlc.record.value.recipientAddress, SAMPLE_ADDR_A);
    }

    // Vault
    const vaultBytes = encodeVaultStorage(new Uint8Array(32).fill(0x22), 1_900_000_000n);
    const decVault = decodeContractStorageValue(`0x${bytesToHex(vaultBytes)}`, "vault");
    assert.equal(decVault.record.kind, "vault");
    if (decVault.record.kind === "vault") {
      assert.equal(decVault.record.value.ownerAddress, SAMPLE_ADDR_B);
      assert.equal(decVault.record.value.lockUntil, "1900000000");
    }

    // Multisig
    const msBytes = encodeMultisigStorage(
      [new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)],
      2,
    );
    const decMs = decodeContractStorageValue(`0x${bytesToHex(msBytes)}`, "multisig");
    assert.equal(decMs.record.kind, "multisig");
    if (decMs.record.kind === "multisig") {
      assert.equal(decMs.record.value.threshold, 2);
      assert.equal(decMs.record.value.ownersAddresses.length, 2);
    }
  });

  it("serves POST /api/contract_storage on source=local for known keys, empty 0x for unknown keys, and 403 on source=mainnet", async () => {
    const validReq = buildContractStorageRequest({
      contract: SAMPLE_HEX_A,
      key: "name:alice",
      schemaHint: "name_entry",
    });
    assert.equal(validReq.ok, true);

    // 1. Known key `name:alice` on local simulator
    const localRes = await dispatchApi(
      new Request("http://localhost:8080/api/contract_storage?source=local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract: SAMPLE_HEX_A,
          key: "name:alice",
          schemaHint: "name_entry",
        }),
      }),
    );
    assert.equal(localRes.status, 200);
    const localBody = (await localRes.json()) as ContractStorageResponse;
    assert.equal(localBody.ok, true);
    assert.equal(localBody.isEmpty, false);
    assert.equal(localBody.rpcMethod, "kovanica_getStorageAt");
    const decodedAlice = decodeContractStorageValue(
      localBody.storageHex,
      localBody.query.schemaHint,
    );
    assert.equal(decodedAlice.record.kind, "name_entry");

    // 2. Known key `token:meta` on local simulator
    const tokenRes = await dispatchApi(
      new Request("http://localhost:8080/api/contract_storage?source=local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract: SAMPLE_HEX_A,
          key: "token:meta",
          schemaHint: "token_meta",
        }),
      }),
    );
    assert.equal(tokenRes.status, 200);
    const tokenBody = (await tokenRes.json()) as ContractStorageResponse;
    const decodedToken = decodeContractStorageValue(
      tokenBody.storageHex,
      tokenBody.query.schemaHint,
    );
    assert.equal(decodedToken.record.kind, "token_meta");

    // 3. Unknown key returns empty `0x` storage slot
    const unknownRes = await dispatchApi(
      new Request("http://localhost:8080/api/contract_storage?source=local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract: SAMPLE_HEX_A,
          key: "name:unregistered-slot-key",
        }),
      }),
    );
    assert.equal(unknownRes.status, 200);
    const unknownBody = (await unknownRes.json()) as ContractStorageResponse;
    assert.equal(unknownBody.isEmpty, true);
    assert.equal(unknownBody.storageHex, "0x");

    // 4. Mainnet isolation returns 403
    const mainnetRes = await dispatchApi(
      new Request("http://localhost:8080/api/contract_storage?source=mainnet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract: SAMPLE_HEX_A,
          key: "name:alice",
        }),
      }),
    );
    assert.equal(mainnetRes.status, 403);
  });
});
