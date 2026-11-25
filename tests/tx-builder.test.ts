import { test } from "node:test";
import assert from "node:assert/strict";
import { blake3 } from "@noble/hashes/blake3.js";
import {
  buildCallSighash,
  buildDeploySighash,
  bytesToHex,
  computeOperationFee,
  deriveDeployedContractAddress,
  deriveRwaAssetId,
  encodeNftCreateCollectionArgs,
  encodeNftMintArgs,
  encodeRwaCreateArgs,
  encodeRwaToAmountArgs,
  encodeSignedCallTx,
  encodeSignedDeployTx,
  encodeTokenCreateArgs,
  hexToBytes,
} from "../src/lib/wallet/tx-builder";
import { dispatchApi } from "../src/lib/api/dispatch.server";
import { FIXED_FEES, MIN_FEE } from "../src/lib/networkConstants";

function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("buildCallSighash matches Rust L1 golden vectors T2 (value=0) and T3 (value=500)", () => {
  // From kovanica-l1/crates/kovanica-types/src/transaction.rs tests::t2_call_value_zero_golden & t3_call_value_golden
  const sender = "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
  const contract = "33".repeat(32);

  const hashT2 = buildCallSighash({
    sender,
    nonce: 6n,
    contract,
    value: 0n,
    method: "transfer",
    args: new Uint8Array([1, 2, 3]),
    gasLimit: 100_000n,
    fee: 10n,
    chainId: 2,
  });
  assert.equal(
    bytesToHex(hashT2),
    "e6ee05c494bc9197cdbf32f02558a36c0bf9f9ce92d7aceff99b65fa7ee3df92",
  );

  const hashT3 = buildCallSighash({
    sender,
    nonce: 6n,
    contract,
    value: 500n,
    method: "transfer",
    args: new Uint8Array([1, 2, 3]),
    gasLimit: 100_000n,
    fee: 10n,
    chainId: 2,
  });
  assert.equal(
    bytesToHex(hashT3),
    "616a96c5e4568b1e165670cd9c4afb4c8d2dd603dbf5b61142f7187a93d29df7",
  );
});

test("deriveDeployedContractAddress matches blake3(sender || u64le(nonce + 1))", () => {
  const sender = "11".repeat(32);
  const derived0 = deriveDeployedContractAddress(sender, 0n);
  const derived7 = deriveDeployedContractAddress(sender, 7n);

  const expected0Seed = new Uint8Array(40);
  expected0Seed.set(hexToBytes(sender), 0);
  new DataView(expected0Seed.buffer).setBigUint64(32, 1n, true);
  assert.equal(derived0, bytesToHex(blake3(expected0Seed)));

  const expected7Seed = new Uint8Array(40);
  expected7Seed.set(hexToBytes(sender), 0);
  new DataView(expected7Seed.buffer).setBigUint64(32, 8n, true);
  assert.equal(derived7, bytesToHex(blake3(expected7Seed)));
  assert.notEqual(derived0, derived7);
});

test("deriveRwaAssetId matches KVP-106 Rust derivation byte-for-byte", () => {
  const res = deriveRwaAssetId("ab".repeat(32), "RE", " padded-id ", 1);
  assert.equal(
    res.assetIdHex,
    "e73e1bb91a32acde9d108adf570f1ac8ace282dfdd75f459f0b6fa8ae44072e6",
  );
  assert.ok(res.assetIdKvnc.startsWith("kvnc"));
  assert.ok(res.assetIdKvnc.endsWith("dag"));
});

test("bincode encoders produce canonical KVP-102 token, KVP-106 NFT, and KVP-106 RWA calldata", () => {
  const tokenArgs = encodeTokenCreateArgs({
    name: "Gold",
    symbol: "GLD",
    decimals: 9,
    initialSupply: 1_000_000_000n,
    icon: "",
  });
  // (8 + 4) + (8 + 3) + 1 + 16 + (8 + 0) = 48 bytes
  assert.equal(tokenArgs.length, 48);

  const colArgs = encodeNftCreateCollectionArgs({
    name: "Genesis",
    symbol: "GEN",
    baseUri: "ipfs://cid/",
  });
  // (8 + 7) + (8 + 3) + (8 + 11) = 45 bytes
  assert.equal(colArgs.length, 45);

  const nftMintArgs = encodeNftMintArgs({
    collection: "22".repeat(32),
    to: "33".repeat(32),
    tokenId: 42n,
    tokenUri: "1.json",
  });
  // 32 + 32 + 16 + (8 + 6) = 94 bytes
  assert.equal(nftMintArgs.length, 94);

  const rwaCreateArgs = encodeRwaCreateArgs({
    name: "Tower",
    symbol: "TWR",
    assetClass: "RE",
    uniqueId: "tower-1",
    version: 1,
    jurisdiction: "RS",
    metadataHashHex: "44".repeat(32),
    metadataUri: "ipfs://meta",
    legalUri: "",
    custodyUri: "",
    decimals: 0,
    maxSupply: 1000n,
    initialSupply: 100n,
  });
  assert.ok(rwaCreateArgs.length > 120);

  const rwaMintArgs = encodeRwaToAmountArgs("55".repeat(32), 25n);
  // 32 + 16 = 48 bytes
  assert.equal(rwaMintArgs.length, 48);
});

test("encodeSignedDeployTx uses variant 5 and encodeSignedCallTx uses variant 6", () => {
  const sender = "aa".repeat(32);
  const code = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const sighashDeploy = buildDeploySighash({ sender, nonce: 0n, code, fee: 100_000n, chainId: 2 });
  const rawDeployHex = encodeSignedDeployTx({
    sender,
    nonce: 0n,
    code,
    fee: 100_000n,
    signatureHex: "bb".repeat(64),
    sighash: sighashDeploy,
  });
  const deployBytes = hexToBytes(rawDeployHex);
  // Variant index sits immediately after sender (32) + nonce (8) = offset 40
  assert.equal(new DataView(deployBytes.buffer).getUint32(40, true), 5);

  const args = new Uint8Array([1, 2, 3, 4]);
  const sighashCall = buildCallSighash({
    sender,
    nonce: 1n,
    contract: "cc".repeat(32),
    method: "token_create",
    args,
    fee: 100_000n,
    chainId: 2,
  });
  const rawCallHex = encodeSignedCallTx({
    sender,
    nonce: 1n,
    contract: "cc".repeat(32),
    method: "token_create",
    args,
    fee: 100_000n,
    signatureHex: "dd".repeat(64),
    sighash: sighashCall,
  });
  const callBytes = hexToBytes(rawCallHex);
  assert.equal(new DataView(callBytes.buffer).getUint32(40, true), 6);
});

test("computeOperationFee enforces FIXED_FEES when active and uses dynamic byte fee pre-activation", () => {
  const preActive = computeOperationFee("token_create", 300, 1n, false);
  assert.equal(preActive, BigInt(MIN_FEE));

  const active = computeOperationFee("token_create", 300, 1n, true);
  assert.equal(active, BigInt(FIXED_FEES.token_create));

  const activeNft = computeOperationFee("nft_create_collection", 300, 1n, true);
  assert.equal(activeNft, BigInt(FIXED_FEES.nft_create_collection));

  const activeRwa = computeOperationFee("rwa_create", 300, 1n, true);
  assert.equal(activeRwa, BigInt(FIXED_FEES.rwa_create));
});

test("GET /api/account_nonce and GET /api/contract_code proxy RPC and validate inputs", async () => {
  const restore = stubFetch((_url, init) => {
    const parsed = JSON.parse(String(init?.body ?? "{}")) as { method: string };
    if (parsed.method === "kovanica_getNonce") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x5" });
    }
    if (parsed.method === "kovanica_getBalance") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2540be400" }); // 10 KVNC
    }
    if (parsed.method === "kovanica_estimateFee") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x1" });
    }
    if (parsed.method === "kovanica_getCode") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x0061736d01000000" });
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result: null });
  });

  try {
    const addr = "42".repeat(32);
    const nonceRes = await dispatchApi(
      new Request(`https://testnet.kovanica.online/api/account_nonce?address=${addr}`),
    );
    assert.equal(nonceRes.status, 200);
    const nonceBody = (await nonceRes.json()) as {
      nonce: string;
      balance: string;
      fee_rate: string;
      chain_id: number;
    };
    assert.equal(nonceBody.nonce, "5");
    assert.equal(nonceBody.balance, "10000000000");
    assert.equal(nonceBody.fee_rate, "1");
    assert.equal(nonceBody.chain_id, 2);

    const codeRes = await dispatchApi(
      new Request(`https://testnet.kovanica.online/api/contract_code?contract=${addr}`),
    );
    assert.equal(codeRes.status, 200);
    const codeBody = (await codeRes.json()) as { deployed: boolean; code_bytes: number };
    assert.equal(codeBody.deployed, true);
    assert.equal(codeBody.code_bytes, 8);

    const badNonce = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/account_nonce?address=bad"),
    );
    assert.equal(badNonce.status, 400);

    const badCode = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/contract_code?contract=bad"),
    );
    assert.equal(badCode.status, 400);

    const mainnetNonce = await dispatchApi(
      new Request(`https://testnet.kovanica.online/api/account_nonce?source=mainnet&address=${addr}`),
    );
    assert.equal(mainnetNonce.status, 503);
  } finally {
    restore();
  }
});
