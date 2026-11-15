import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFaucetError,
  classifyHealth,
  HEALTH_LABEL,
  healthFromPayload,
  healthLabel,
  healthTone,
} from "../src/lib/api/health";
import { dispatchApi } from "../src/lib/api/dispatch.server";

/**
 * Liveness vocabulary: GET /health is the source of truth.
 *   200 → live
 *   503 → stalled (reads still answer; never "down")
 *   transport failure / anything else → down
 */
test("classifyHealth maps 200 to live", () => {
  assert.equal(classifyHealth({ healthStatus: 200 }), "live");
});

test("classifyHealth maps 503 to stalled, not down", () => {
  assert.equal(classifyHealth({ healthStatus: 503 }), "stalled");
});

test("classifyHealth maps transport failure to down", () => {
  assert.equal(classifyHealth({ healthStatus: null, failed: true }), "down");
});

test("classifyHealth falls back to the RPC status when /health is absent", () => {
  assert.equal(classifyHealth({ healthStatus: null, rpcStatus: 200 }), "live");
  assert.equal(classifyHealth({ healthStatus: null, rpcStatus: 503 }), "stalled");
  assert.equal(classifyHealth({ healthStatus: null, rpcStatus: 500 }), "down");
});

test("stalled label never reads as down or offline", () => {
  const label = healthLabel("stalled");
  assert.equal(label, HEALTH_LABEL.stalled);
  assert.match(label, /Stalled/);
  assert.doesNotMatch(label.toLowerCase(), /down|offline/);
  assert.equal(healthTone("stalled"), "warn");
  assert.equal(healthTone("live"), "ok");
  assert.equal(healthTone("down"), "danger");
});

test("healthFromPayload reads state without trusting the shape", () => {
  assert.equal(healthFromPayload({ state: "live" }), "live");
  assert.equal(healthFromPayload({ state: "stalled" }), "stalled");
  assert.equal(healthFromPayload({ state: "down" }), "down");
  assert.equal(healthFromPayload({ state: "banana" }), "down");
  assert.equal(healthFromPayload(null), "down");
  assert.equal(healthFromPayload("stalled"), "down");
});

test("classifyFaucetError separates 503 (stalled) from 502/504 (offline)", () => {
  assert.equal(classifyFaucetError("node busy", 503), "stalled");
  assert.equal(classifyFaucetError("bad gateway", 502), "offline");
  assert.equal(classifyFaucetError("gateway timeout", 504), "offline");
  assert.equal(classifyFaucetError("The testnet is stalled", null), "stalled");
  assert.equal(classifyFaucetError("faucet unavailable", 503), "unavailable");
  assert.equal(classifyFaucetError("not configured", null), "unavailable");
  assert.equal(classifyFaucetError("lifetime cap reached", 400), "cap");
  assert.equal(classifyFaucetError("faucet is dry", 400), "dry");
  assert.equal(classifyFaucetError("too soon, wait a moment", 400), "cooldown");
  assert.equal(classifyFaucetError("Connection refused", null), "offline");
});

/** /api/health always answers 200 so clients can map stalled explicitly. */
test("GET /api/health returns 200 with state=stalled when the node answers 503", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(null, { status: 503 })) as unknown as typeof fetch;
  try {
    const res = await dispatchApi(
      new Request("https://explorer.kovanica.online/api/health?source=testnet"),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { state: string; status: number | null };
    assert.equal(body.state, "stalled");
    assert.equal(body.status, 503);
  } finally {
    globalThis.fetch = original;
  }
});

test("GET /api/health returns 200 with state=down on transport failure", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  try {
    const res = await dispatchApi(
      new Request("https://explorer.kovanica.online/api/health?source=testnet"),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { state: string };
    assert.equal(body.state, "down");
  } finally {
    globalThis.fetch = original;
  }
});

test("/api/state returns 503 when the RPC answers 503, 502 when it is unreachable", async () => {
  const original = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response("degraded", { status: 503 })) as unknown as typeof fetch;
  try {
    const res = await dispatchApi(
      new Request("https://explorer.kovanica.online/api/state?source=testnet"),
    );
    assert.equal(res.status, 503, "stalled chain must answer 503, not 502");
  } finally {
    globalThis.fetch = original;
  }

  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  try {
    const res = await dispatchApi(
      new Request("https://explorer.kovanica.online/api/state?source=testnet"),
    );
    assert.equal(res.status, 502, "unreachable node must answer 502");
  } finally {
    globalThis.fetch = original;
  }
});
