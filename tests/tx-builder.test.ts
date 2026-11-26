import { test } from "node:test";
import assert from "node:assert/strict";
import { blake3 } from "@noble/hashes/blake3.js";
import {
  buildCallSighash,
  buildDeploySighash,
  bytesToHex,
  computeDynamicCallFee,
  computeOperationFee,
  deriveDeployedContractAddress,
  deriveRwaAssetId,
  encodeNftCreateCollectionArgs,
  encodeNftMintArgs,
  encodeRwaCreateArgs,
  encodeRwaToAmountArgs,
  encodeSignedCallTx,
  encodeSignedDeployTx,
  encodeTokenBuyArgs,
  encodeTokenCreateArgs,
  encodeTokenInitPoolArgs,
  encodeTokenSellArgs,
  executeTokenBuy,
  executeTokenSell,
  hexToBytes,
  initTokenPool,
  type ActiveSigner,
} from "../src/lib/wallet/tx-builder";
import { dispatchApi } from "../src/lib/api/dispatch.server";
import { rpcCall, rpcWriteToken } from "../src/lib/api/rpc-url.server";
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

test("AMM bincode encoders match L1 kovanica-token wire layouts (token_init_pool, token_buy, token_sell)", () => {
  // Matches kovanica-cli/src/contracts.rs: bincode::serialize(&(10u128, 20u128, 30u16))
  const initArgs = encodeTokenInitPoolArgs({ kunaIn: 10n, tokensIn: 20n, feeBps: 30 });
  assert.equal(initArgs.length, 34);
  const initView = new DataView(initArgs.buffer);
  assert.equal(initView.getBigUint64(0, true), 10n);
  assert.equal(initView.getBigUint64(8, true), 0n);
  assert.equal(initView.getBigUint64(16, true), 20n);
  assert.equal(initView.getBigUint64(24, true), 0n);
  assert.equal(initView.getUint16(32, true), 30);

  assert.throws(() => encodeTokenInitPoolArgs({ kunaIn: 0n, tokensIn: 20n, feeBps: 30 }));
  assert.throws(() => encodeTokenInitPoolArgs({ kunaIn: 10n, tokensIn: 0n, feeBps: 30 }));
  assert.throws(() => encodeTokenInitPoolArgs({ kunaIn: 10n, tokensIn: 20n, feeBps: 1001 }));

  // Matches token_buy(amount_in: u128, min_out: u128) -> 32 bytes
  const buyArgs = encodeTokenBuyArgs({ amountIn: 1_000_000_000n, minOut: 950_000n });
  assert.equal(buyArgs.length, 32);
  const buyView = new DataView(buyArgs.buffer);
  assert.equal(buyView.getBigUint64(0, true), 1_000_000_000n);
  assert.equal(buyView.getBigUint64(16, true), 950_000n);

  // Matches token_sell(amount_in: u128, min_out: u128) -> 32 bytes
  const sellArgs = encodeTokenSellArgs({ amountIn: 500_000n, minOut: 490_000_000n });
  assert.equal(sellArgs.length, 32);
  const sellView = new DataView(sellArgs.buffer);
  assert.equal(sellView.getBigUint64(0, true), 500_000n);
  assert.equal(sellView.getBigUint64(16, true), 490_000_000n);

  assert.throws(() => encodeTokenBuyArgs({ amountIn: 0n, minOut: 0n }));
  assert.throws(() => encodeTokenSellArgs({ amountIn: 0n, minOut: 0n }));
});

test("computeDynamicCallFee enforces MIN_FEE floor and scales with byte fee rate", () => {
  assert.equal(computeDynamicCallFee(250, 1n), BigInt(MIN_FEE));
  // 500 bytes * 100 atoms/byte * 1.2 = 60,000 atoms > MIN_FEE (5,000)
  assert.equal(computeDynamicCallFee(500, 100n), 60_000n);
});

test("initTokenPool, executeTokenBuy, and executeTokenSell sign and broadcast expected Call payloads", async () => {
  const signedCalls: Array<{
    method: string;
    value?: string | number;
    argsHex?: string;
    nonce: string | number;
    chainId?: number;
  }> = [];
  const broadcasts: string[] = [];

  const signer: ActiveSigner = {
    kind: "extension",
    addressHex: "11".repeat(32),
    addressKvnc: "kvnc" + "q".repeat(57) + "dag",
    provider: {
      connect: async () => ({ accounts: ["11".repeat(32)], chainId: 2 }),
      getAccounts: async () => ["11".repeat(32)],
      signTransaction: async (tx) => {
        signedCalls.push({
          method: tx.method,
          value: tx.value,
          argsHex: tx.argsHex,
          nonce: tx.nonce,
          chainId: tx.chainId,
        });
        return {
          rawTxHex: "deadbeef",
          signingHashHex: "aa".repeat(32),
          signatureHex: "bb".repeat(64),
        };
      },
    },
  };

  const restore = stubFetch((url, init) => {
    if (url.includes("/api/account_nonce")) {
      return Response.json({
        address: "11".repeat(32),
        nonce: "7",
        balance: "50000000000", // 50 KVNC
        fee_rate: "1",
        chain_id: 2,
      });
    }
    if (url.includes("/api/fee_schedule")) {
      return Response.json({ active: true, chain_id: "2" });
    }
    if (url.includes("/api/submit_tx")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { tx_hex: string };
      broadcasts.push(body.tx_hex);
      return Response.json({ ok: true, tx: "cc".repeat(32) });
    }
    return Response.json({});
  });

  try {
    const contract = "22".repeat(32);

    const initRes = await initTokenPool(signer, {
      contract,
      kunaInAtoms: 5_000_000_000n,
      tokensInAtoms: 1_000_000n,
      feeBps: 30,
    });
    assert.equal(initRes.method, "token_init_pool");
    assert.equal(initRes.txHash, "cc".repeat(32));

    const buyRes = await executeTokenBuy(signer, {
      contract,
      kunaInAtoms: 1_000_000_000n,
      minOutAtoms: 150_000n,
    });
    assert.equal(buyRes.method, "token_buy");

    const sellRes = await executeTokenSell(signer, {
      contract,
      tokensInAtoms: 100_000n,
      minOutAtoms: 400_000_000n,
    });
    assert.equal(sellRes.method, "token_sell");

    assert.equal(signedCalls.length, 3);
    assert.equal(signedCalls[0]?.method, "token_init_pool");
    assert.equal(signedCalls[0]?.value, "5000000000");
    assert.equal(signedCalls[0]?.argsHex?.length, 68); // 34 bytes

    assert.equal(signedCalls[1]?.method, "token_buy");
    assert.equal(signedCalls[1]?.value, "1000000000");
    assert.equal(signedCalls[1]?.argsHex?.length, 64); // 32 bytes

    assert.equal(signedCalls[2]?.method, "token_sell");
    assert.equal(signedCalls[2]?.value, "0");
    assert.equal(signedCalls[2]?.argsHex?.length, 64); // 32 bytes

    assert.equal(broadcasts.length, 3);
  } finally {
    restore();
  }
});

test("rpcCall attaches server-only Authorization Bearer header when KOVANICA_RPC_WRITE_TOKEN(S) is set", async () => {
  const prevSingle = process.env.KOVANICA_RPC_WRITE_TOKEN;
  const prevList = process.env.KOVANICA_RPC_WRITE_TOKENS;
  const seenAuth: Array<string | undefined> = [];

  const restore = stubFetch((_url, init) => {
    const hdrs = (init?.headers ?? {}) as Record<string, string>;
    seenAuth.push(hdrs.authorization ?? hdrs.Authorization);
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x1" });
  });

  try {
    delete process.env.KOVANICA_RPC_WRITE_TOKEN;
    delete process.env.KOVANICA_RPC_WRITE_TOKENS;
    assert.equal(rpcWriteToken(), null);
    await rpcCall("kovanica_blockNumber");

    process.env.KOVANICA_RPC_WRITE_TOKENS = "tok-a, tok-b";
    assert.equal(rpcWriteToken(), "tok-a");
    await rpcCall("kovanica_sendRawTransaction", ["0xaa"]);

    process.env.KOVANICA_RPC_WRITE_TOKEN = "tok-primary";
    assert.equal(rpcWriteToken(), "tok-primary");
    await rpcCall("kovanica_sendRawTransaction", ["0xbb"]);

    assert.deepEqual(seenAuth, [undefined, "Bearer tok-a", "Bearer tok-primary"]);
  } finally {
    restore();
    if (prevSingle === undefined) delete process.env.KOVANICA_RPC_WRITE_TOKEN;
    else process.env.KOVANICA_RPC_WRITE_TOKEN = prevSingle;
    if (prevList === undefined) delete process.env.KOVANICA_RPC_WRITE_TOKENS;
    else process.env.KOVANICA_RPC_WRITE_TOKENS = prevList;
  }
});

test("POST /api/token_submit encodes TransactionKind::Call with wire variant index 6", async () => {
  const fromHex = "11".repeat(32);
  const toHex = "22".repeat(32);
  const tokenHex = "33".repeat(32);
  // Minimal valid bincode TokenState holding 1_000_000_000 for fromHex:
  // name("T") + symbol("T") + decimals(9) + totalSupply(1e9) + owner(32) + minter(32)
  // + balances(1 entry: fromHex -> 1e9) + allowances(0) + paused(false) + icon("")
  const encStr = (s: string) => {
    const b = new TextEncoder().encode(s);
    const out = new Uint8Array(8 + b.length);
    new DataView(out.buffer).setBigUint64(0, BigInt(b.length), true);
    out.set(b, 8);
    return out;
  };
  const u64 = (v: bigint) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v, true);
    return b;
  };
  const u128 = (v: bigint) => {
    const b = new Uint8Array(16);
    new DataView(b.buffer).setBigUint64(0, v, true);
    return b;
  };
  const parts = [
    encStr("Test"),
    encStr("TST"),
    Uint8Array.of(9),
    u128(1_000_000_000n),
    hexToBytes(fromHex),
    hexToBytes(fromHex),
    u64(1n),
    hexToBytes(fromHex),
    u128(1_000_000_000n),
    u64(0n),
    Uint8Array.of(0),
    encStr(""),
  ];
  const totalLen = parts.reduce((a, p) => a + p.length, 0);
  const stateBytes = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) {
    stateBytes.set(p, off);
    off += p.length;
  }
  const stateHex = `0x${bytesToHex(stateBytes)}`;

  let submittedRawHex = "";
  const restore = stubFetch((_url, init) => {
    const parsed = JSON.parse(String(init?.body ?? "{}")) as { method: string; params?: unknown[] };
    if (parsed.method === "kovanica_getStorageAt") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: stateHex });
    }
    if (parsed.method === "kovanica_getBalance") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2540be400" }); // 10 KVNC
    }
    if (parsed.method === "kovanica_getNonce") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x3" });
    }
    if (parsed.method === "kovanica_sendRawTransaction") {
      submittedRawHex = String(parsed.params?.[0] ?? "");
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x" + "ee".repeat(32) });
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result: null });
  });

  try {
    const sig = "aa".repeat(64);
    const res = await dispatchApi(
      new Request(
        `https://testnet.kovanica.online/api/token_submit?from=${fromHex}&token=${tokenHex}&to=${toHex}&amount=1000&sig=${sig}`,
        { method: "POST" },
      ),
    );
    assert.equal(res.status, 200);
    const rawBytes = hexToBytes(submittedRawHex);
    // Variant index sits immediately after sender (32) + nonce (8) = offset 40
    assert.equal(new DataView(rawBytes.buffer).getUint32(40, true), 6);
  } finally {
    restore();
  }
});
