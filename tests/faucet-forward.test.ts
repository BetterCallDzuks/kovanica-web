/**
 * The web → faucet hop: whose IP is forwarded, and what a failure means.
 *
 * These are unit tests on the pure modules; no faucet, no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clientIpFromHeaders,
  parseIpLiteral,
  trustProxyHeaders,
  TRUST_PROXY_HEADERS_ENV,
} from "../src/lib/api/client-ip.server";
import {
  dispenseFromFaucet,
  dispensedAtoms,
  FaucetError,
  faucetErrorKind,
  faucetHttpStatus,
  FAUCET_TIMEOUT_MS,
} from "../src/lib/api/faucet.server";
import { faucetErrorFromBody } from "../src/lib/api/health";

type FetchCall = { url: string; init?: RequestInit };

function stubFetch(respond: () => Response): { calls: FetchCall[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return respond();
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T>;
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T;
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>) {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const out = fn();
    if (out instanceof Promise) return out.finally(restore);
    restore();
    return out;
  } catch (e) {
    restore();
    throw e;
  }
}

const FAUCET_URL = "http://127.0.0.1:3000/faucet";
const CLIENT_IP = "198.51.100.5";

test("client IP comes from X-Real-IP, never from the client's own X-Forwarded-For", () => {
  const headers = new Headers({
    // nginx overwrites X-Real-IP with $remote_addr…
    "x-real-ip": CLIENT_IP,
    // …and appends the real address to whatever X-Forwarded-For the client sent.
    "x-forwarded-for": "203.0.113.99",
  });
  assert.equal(clientIpFromHeaders(headers), CLIENT_IP);
});

test("without X-Real-IP only the last X-Forwarded-For hop is trusted", () => {
  const spoofed = new Headers({ "x-forwarded-for": "203.0.113.99, 203.0.113.98, 198.51.100.5" });
  assert.equal(clientIpFromHeaders(spoofed), CLIENT_IP);
});

test("non-IP header values are ignored, never forwarded", () => {
  assert.equal(parseIpLiteral("unknown"), null);
  assert.equal(parseIpLiteral("1.2.3.4:5555"), null);
  assert.equal(parseIpLiteral(""), null);
  assert.equal(parseIpLiteral(null), null);
  assert.equal(parseIpLiteral("[2001:db8::1]"), "2001:db8::1");
  assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "not-an-ip" })), null);
  assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": "garbage, also-garbage" })), null);
  assert.equal(clientIpFromHeaders(new Headers()), null);
});

test("proxy headers are ignored when the deployment opts out", () => {
  const headers = new Headers({ "x-real-ip": CLIENT_IP, "x-forwarded-for": CLIENT_IP });
  withEnv({ [TRUST_PROXY_HEADERS_ENV]: "0" }, () => {
    assert.equal(trustProxyHeaders(), false);
    assert.equal(clientIpFromHeaders(headers), null);
  });
  withEnv({ [TRUST_PROXY_HEADERS_ENV]: "" }, () => {
    assert.equal(trustProxyHeaders(), true);
    assert.equal(clientIpFromHeaders(headers), CLIENT_IP);
  });
});

test("the outgoing request carries X-Forwarded-For and nothing from the browser", async () => {
  await withEnv({ KOVANICA_FAUCET_URL: FAUCET_URL }, async () => {
    const stub = stubFetch(
      () =>
        new Response(JSON.stringify({ success: true, message: "Dispensed 10 KVNC", tx_hash: "0xabc" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    try {
      const incoming = new Headers({
        "x-real-ip": CLIENT_IP,
        "x-forwarded-for": "203.0.113.99",
        authorization: "Bearer super-secret",
        cookie: "session=1",
        "user-agent": "browser",
      });
      const grant = await dispenseFromFaucet("kvnc-test-address", incoming);

      assert.equal(grant.ok, true);
      assert.equal(grant.tx_hash, "0xabc");
      assert.equal(grant.message, "Dispensed 10 KVNC");
      assert.equal(grant.amount, 10_000_000_000);

      assert.equal(stub.calls.length, 1);
      const call = stub.calls[0];
      assert.equal(call.url, FAUCET_URL);
      assert.equal(call.init?.method, "POST");
      const sent = new Headers(call.init?.headers);
      assert.equal(sent.get("x-forwarded-for"), CLIENT_IP);
      assert.equal(sent.get("authorization"), null);
      assert.equal(sent.get("cookie"), null);
      assert.equal(sent.get("user-agent"), null);
      assert.deepEqual(JSON.parse(String(call.init?.body)), { address: "kvnc-test-address" });
    } finally {
      stub.restore();
    }
  });
});

test("no proxy header means no X-Forwarded-For at all", async () => {
  await withEnv({ KOVANICA_FAUCET_URL: FAUCET_URL }, async () => {
    const stub = stubFetch(
      () => new Response(JSON.stringify({ success: true, message: "Dispensed 10 KVNC" }), { status: 200 }),
    );
    try {
      await dispenseFromFaucet("kvnc-test-address", new Headers());
      const sent = new Headers(stub.calls[0].init?.headers);
      assert.equal(sent.has("x-forwarded-for"), false);
    } finally {
      stub.restore();
    }
  });
});

test("faucet 429 maps to cooldown, not to a generic cap", async () => {
  await withEnv({ KOVANICA_FAUCET_URL: FAUCET_URL }, async () => {
    const stub = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            success: false,
            message: "Rate limit exceeded for address. Max 1 requests per 86400 seconds.",
          }),
          { status: 429 },
        ),
    );
    try {
      await assert.rejects(
        () => dispenseFromFaucet("kvnc-test-address", new Headers()),
        (error: unknown) => {
          assert.ok(error instanceof FaucetError);
          assert.equal(error.kind, "cooldown");
          assert.equal(error.status, 429);
          return true;
        },
      );
      assert.equal(faucetHttpStatus("cooldown"), 429);
    } finally {
      stub.restore();
    }
  });
});

test("faucet 503 maps to dry when funds are low, else unavailable", async () => {
  assert.equal(faucetErrorKind("Faucet is low on funds; try again later.", 503), "dry");
  assert.equal(faucetErrorKind("no balance available", 503), "dry");
  assert.equal(faucetErrorKind("upstream not ready", 503), "unavailable");
  assert.equal(faucetHttpStatus("dry"), 503);
  assert.equal(faucetHttpStatus("unavailable"), 503);

  await withEnv({ KOVANICA_FAUCET_URL: FAUCET_URL }, async () => {
    const stub = stubFetch(
      () =>
        new Response(JSON.stringify({ success: false, message: "Faucet is low on funds; try again later." }), {
          status: 503,
        }),
    );
    try {
      await assert.rejects(
        () => dispenseFromFaucet("kvnc-test-address", new Headers()),
        (error: unknown) => error instanceof FaucetError && error.kind === "dry",
      );
    } finally {
      stub.restore();
    }
  });
});

test("an unset faucet endpoint is unavailable, not offline", async () => {
  await withEnv({ KOVANICA_FAUCET_URL: undefined }, async () => {
    await assert.rejects(
      () => dispenseFromFaucet("kvnc-test-address", new Headers()),
      (error: unknown) => error instanceof FaucetError && error.kind === "unavailable",
    );
  });
});

test("a transport failure is offline", async () => {
  await withEnv({ KOVANICA_FAUCET_URL: FAUCET_URL }, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("fetch failed");
    }) as typeof fetch;
    try {
      await assert.rejects(
        () => dispenseFromFaucet("kvnc-test-address", new Headers()),
        (error: unknown) => error instanceof FaucetError && error.kind === "offline",
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});

test("the dispensed amount is read from the faucet's own message", () => {
  assert.equal(dispensedAtoms("Dispensed 10 KVNC"), 10_000_000_000);
  assert.equal(dispensedAtoms("Dispensed 2.5 KVNC"), 2_500_000_000);
  assert.equal(dispensedAtoms("Dispensed 10 KVNC", 7_000_000_000), 7_000_000_000);
  assert.equal(dispensedAtoms("something else"), null);
});

test("the faucet hop is bounded by a 10 s timeout", () => {
  assert.equal(FAUCET_TIMEOUT_MS, 10_000);
});

test("the browser reads the server's kind out of the error body", () => {
  assert.deepEqual(faucetErrorFromBody('{"ok":false,"kind":"cooldown","message":"cooling"}', 429), {
    kind: "cooldown",
    message: "cooling",
  });
  assert.deepEqual(faucetErrorFromBody('{"ok":false,"kind":"dry","message":"low on funds"}', 503), {
    kind: "dry",
    message: "low on funds",
  });
  // A plain-text body still classifies the old way.
  assert.equal(faucetErrorFromBody("faucet unavailable", 503).kind, "unavailable");
  assert.equal(faucetErrorFromBody("bad gateway", 502).kind, "offline");
});
