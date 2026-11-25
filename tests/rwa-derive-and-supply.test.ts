import { test } from "node:test";
import assert from "node:assert/strict";
import { blake3 } from "@noble/hashes/blake3.js";

import { dispatchApi } from "../src/lib/api/dispatch.server";
import { encodeAddress } from "../src/lib/wallet/address";
import {
  ATOM,
  FOUNDER_AMOUNT,
  HALVING_ERA,
  MAX_SUPPLY,
  NETWORK_ID,
  SUBSIDY,
  TOKEN,
} from "../src/lib/networkConstants";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function expectedKvp106AssetId(
  issuerHex: string,
  assetClass: string,
  uniqueId: string,
  version: number,
): { asset_id: string; asset_id_kvnc: string } {
  const enc = new TextEncoder();
  const prefix = enc.encode("kvp106:rwa:v1");
  const issuer = hexToBytes(issuerHex);
  const cls = enc.encode(assetClass);
  const uid = enc.encode(uniqueId);
  const ver = new Uint8Array(4);
  new DataView(ver.buffer).setUint32(0, version, true);

  const buf = new Uint8Array(prefix.length + 32 + 1 + cls.length + 1 + uid.length + 4);
  let off = 0;
  buf.set(prefix, off);
  off += prefix.length;
  buf.set(issuer, off);
  off += 32;
  buf[off++] = 0;
  buf.set(cls, off);
  off += cls.length;
  buf[off++] = 0;
  buf.set(uid, off);
  off += uid.length;
  buf.set(ver, off);

  const digest = blake3(buf);
  return {
    asset_id: bytesToHex(digest),
    asset_id_kvnc: encodeAddress(digest),
  };
}

function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("POST /api/rwa/derive matches KVP-106 Rust blake3 derivation for 64-hex and kvnc...dag issuers", async () => {
  const issuerHex = "42".repeat(32);
  const issuerKvnc = encodeAddress(hexToBytes(issuerHex));
  const expected = expectedKvp106AssetId(issuerHex, "RE", "tower-12a", 1);

  const resHex = await dispatchApi(
    new Request(
      `https://testnet.kovanica.online/api/rwa/derive?issuer=${issuerHex}&class=RE&id=tower-12a&version=1`,
      { method: "POST" },
    ),
  );
  assert.equal(resHex.status, 200);
  const bodyHex = (await resHex.json()) as { asset_id: string; asset_id_kvnc: string };
  assert.deepEqual(bodyHex, expected);

  const resKvnc = await dispatchApi(
    new Request(
      `https://testnet.kovanica.online/api/rwa/derive?issuer=${encodeURIComponent(issuerKvnc)}&class=RE&id=tower-12a&version=1`,
      { method: "POST" },
    ),
  );
  assert.equal(resKvnc.status, 200);
  const bodyKvnc = (await resKvnc.json()) as { asset_id: string; asset_id_kvnc: string };
  assert.deepEqual(bodyKvnc, expected);

  const expectedBondV2 = expectedKvp106AssetId(issuerHex, "BOND", "bond-2026-001", 2);
  const resLocalJson = await dispatchApi(
    new Request("https://testnet.kovanica.online/api/rwa/derive?source=local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        issuer: issuerKvnc,
        asset_class: "BOND",
        unique_id: "bond-2026-001",
        version: 2,
      }),
    }),
  );
  assert.equal(resLocalJson.status, 200);
  assert.deepEqual(await resLocalJson.json(), expectedBondV2);

  // Mixed query param (?issuer=...) + JSON body fields
  const expectedMixed = expectedKvp106AssetId("ab".repeat(32), "RE", "mixed-test", 1);
  const resMixed = await dispatchApi(
    new Request(`https://testnet.kovanica.online/api/rwa/derive?issuer=${"ab".repeat(32)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        asset_class: "RE",
        unique_id: "mixed-test",
        version: 1,
      }),
    }),
  );
  assert.equal(resMixed.status, 200);
  assert.deepEqual(await resMixed.json(), expectedMixed);

  // Untrimmed unique_id must match kovanica-l1 derive_asset_id byte-for-byte without trimming
  const expectedUntrimmed = expectedKvp106AssetId("ab".repeat(32), "RE", " padded-id ", 1);
  assert.equal(
    expectedUntrimmed.asset_id,
    "e73e1bb91a32acde9d108adf570f1ac8ace282dfdd75f459f0b6fa8ae44072e6",
  );
  const resUntrimmed = await dispatchApi(
    new Request("https://testnet.kovanica.online/api/rwa/derive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        issuer: "ab".repeat(32),
        asset_class: "RE",
        unique_id: " padded-id ",
        version: 1,
      }),
    }),
  );
  assert.equal(resUntrimmed.status, 200);
  assert.deepEqual(await resUntrimmed.json(), expectedUntrimmed);
});

test("POST /api/rwa/derive validates inputs (400), rejects non-POST (405), and blocks mainnet (403)", async () => {
  const issuerHex = "11".repeat(32);

  const badCases = [
    `issuer=not-an-address&class=RE&id=tower-1&version=1`,
    `issuer=${issuerHex}&class=INVALID&id=tower-1&version=1`,
    `issuer=${issuerHex}&class=RE&id=&version=1`,
    `issuer=${issuerHex}&class=RE&id=${"a".repeat(129)}&version=1`,
    `issuer=${issuerHex}&class=RE&id=tower-1&version=0`,
    `issuer=${issuerHex}&class=RE&id=tower-1&version=-1`,
    `issuer=${issuerHex}&class=RE&id=tower-1&version=abc`,
  ];

  for (const qs of badCases) {
    const res = await dispatchApi(
      new Request(`https://testnet.kovanica.online/api/rwa/derive?${qs}`, { method: "POST" }),
    );
    assert.equal(res.status, 400, `Expected 400 for query: ${qs}`);
  }

  const getRes = await dispatchApi(
    new Request(
      `https://testnet.kovanica.online/api/rwa/derive?issuer=${issuerHex}&class=RE&id=tower-1&version=1`,
      { method: "GET" },
    ),
  );
  assert.equal(getRes.status, 405);

  const mainnetRes = await dispatchApi(
    new Request(
      `https://testnet.kovanica.online/api/rwa/derive?source=mainnet&issuer=${issuerHex}&class=RE&id=tower-1&version=1`,
      { method: "POST" },
    ),
  );
  assert.equal(mainnetRes.status, 403);
});

test("GET /api/supply returns live testnet height + canonical constants, 503 when stalled, 502 when unreachable", async () => {
  const restoreOk = stubFetch((url) => {
    if (url.endsWith("/health")) {
      return new Response(null, { status: 200 });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: { committedHeight: 4242, peers: [] },
    });
  });

  try {
    const res = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/supply?source=testnet"),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.network, NETWORK_ID);
    assert.equal(body.token, TOKEN);
    assert.equal(body.atom, ATOM);
    assert.equal(body.blocks, 4242);
    assert.equal(body.max_supply, MAX_SUPPLY);
    assert.equal(body.founder_amount, FOUNDER_AMOUNT);
    assert.equal(body.subsidy, SUBSIDY);
    assert.equal(body.halving_era, HALVING_ERA);
    assert.equal(body.circulating, null);
    assert.equal(body.burned, null);
    assert.equal(body.native_minted, null);
    assert.equal(body.source, "testnet");
    assert.equal((body.health as { state: string }).state, "live");
  } finally {
    restoreOk();
  }

  const restoreStalled = stubFetch(() => new Response("stalled", { status: 503 }));
  try {
    const res = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/supply?source=testnet"),
    );
    assert.equal(res.status, 503);
  } finally {
    restoreStalled();
  }

  // Partial degradation: /health returns 503 (stalled) while RPC kovanica_syncStatus returns 200
  const restoreHealthStalled = stubFetch((url) => {
    if (url.endsWith("/health")) {
      return new Response("stalled", { status: 503 });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: { committedHeight: 4243, peers: [] },
    });
  });
  try {
    const res = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/supply?source=testnet"),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      blocks: number;
      health: { state: string; status: number };
    };
    assert.equal(body.blocks, 4243);
    assert.equal(body.health.state, "stalled");
    assert.equal(body.health.status, 503);
  } finally {
    restoreHealthStalled();
  }

  const restoreDown = stubFetch(() => {
    throw new TypeError("network down");
  });
  try {
    const res = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/supply?source=testnet"),
    );
    assert.equal(res.status, 502);
  } finally {
    restoreDown();
  }

  const postRes = await dispatchApi(
    new Request("https://testnet.kovanica.online/api/supply?source=testnet", { method: "POST" }),
  );
  assert.equal(postRes.status, 405);
});

test("GET /api/supply supports local source and rejects mainnet with 503", async () => {
  const localRes = await dispatchApi(
    new Request("https://testnet.kovanica.online/api/supply?source=local"),
  );
  assert.equal(localRes.status, 200);
  const localBody = (await localRes.json()) as Record<string, unknown>;
  assert.equal(localBody.source, "local");
  assert.equal(localBody.max_supply, MAX_SUPPLY);
  assert.equal(typeof localBody.circulating, "number");
  assert.equal(typeof localBody.blocks, "number");

  const mainnetRes = await dispatchApi(
    new Request("https://testnet.kovanica.online/api/supply?source=mainnet"),
  );
  assert.equal(mainnetRes.status, 503);
});

test("POST /api/submit_tx forwards valid hex to kovanica_sendRawTransaction and handles errors cleanly", async () => {
  let seenMethod = "";
  let seenParams: unknown[] = [];

  const restoreOk = stubFetch((_url, init) => {
    const parsed = JSON.parse(String(init?.body ?? "{}")) as {
      method: string;
      params: unknown[];
    };
    seenMethod = parsed.method;
    seenParams = parsed.params;
    return Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: "ab".repeat(32),
    });
  });

  try {
    const okRes = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/submit_tx?source=testnet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tx_hex: "0xDEADBEEF" }),
      }),
    );
    assert.equal(okRes.status, 200);
    assert.equal(seenMethod, "kovanica_sendRawTransaction");
    assert.deepEqual(seenParams, ["deadbeef"]);
    assert.deepEqual(await okRes.json(), { ok: true, tx: "ab".repeat(32) });
  } finally {
    restoreOk();
  }

  for (const badBody of ["{}", '{"tx_hex":""}', '{"tx_hex":"abc"}', '{"tx_hex":"zzzz"}', "not-json"]) {
    const badRes = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/submit_tx?source=testnet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: badBody,
      }),
    );
    assert.equal(badRes.status, 400, `Expected 400 for body: ${badBody}`);
  }

  const restore401 = stubFetch(() => new Response("unauthorized", { status: 401 }));
  try {
    const res403 = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/submit_tx?source=testnet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tx_hex: "deadbeef" }),
      }),
    );
    assert.equal(res403.status, 403);
  } finally {
    restore401();
  }

  const mainnetRes = await dispatchApi(
    new Request("https://testnet.kovanica.online/api/submit_tx?source=mainnet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx_hex: "deadbeef" }),
    }),
  );
  assert.equal(mainnetRes.status, 403);

  const getRes = await dispatchApi(
    new Request("https://testnet.kovanica.online/api/submit_tx?source=testnet", {
      method: "GET",
    }),
  );
  assert.equal(getRes.status, 405);
});

test("POST /api/submit_tx?source=local accepts valid hex, queues in local mempool, and rejects invalid inputs", async () => {
  await dispatchApi(
    new Request("https://testnet.kovanica.online/api/reset?source=local", { method: "POST" }),
  );

  try {
    const okRes = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/submit_tx?source=local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tx_hex: "0xDEADBEEF" }),
      }),
    );
    assert.equal(okRes.status, 200);
    const okBody = (await okRes.json()) as { ok: boolean; tx: string };
    assert.equal(okBody.ok, true);
    assert.match(okBody.tx, /^[0-9a-f]{64}$/);

    const stateRes = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/state?source=local"),
    );
    assert.equal(stateRes.status, 200);
    const stateBody = (await stateRes.json()) as { node: { mempool: number; pending: string[] } };
    assert.equal(stateBody.node.mempool, 1);
    assert.ok(stateBody.node.pending.includes(okBody.tx));

    for (const badBody of ["{}", '{"tx_hex":""}', '{"tx_hex":"abc"}', '{"tx_hex":"zzzz"}', "not-json"]) {
      const badRes = await dispatchApi(
        new Request("https://testnet.kovanica.online/api/submit_tx?source=local", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: badBody,
        }),
      );
      assert.equal(badRes.status, 400, `Expected 400 for local submit_tx body: ${badBody}`);
    }

    const getLocalRes = await dispatchApi(
      new Request("https://testnet.kovanica.online/api/submit_tx?source=local", {
        method: "GET",
      }),
    );
    assert.equal(getLocalRes.status, 405);
  } finally {
    await dispatchApi(
      new Request("https://testnet.kovanica.online/api/reset?source=local", { method: "POST" }),
    );
  }
});
