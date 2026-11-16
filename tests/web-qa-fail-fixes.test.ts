/**
 * QA FAIL fixes: security headers / CSP, detail-lookup status codes, and the
 * finality-depth stat that used to be a hardcoded "live" value.
 *
 * Unit tests on pure modules plus dispatchApi with a stubbed fetch; no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCsp,
  createNonce,
  HSTS_VALUE,
  isEmbeddableHost,
  securityHeaders,
} from "../src/lib/security-headers";
import { isAssetId } from "../src/lib/asset-id";
import { lookupFailureStatus } from "../src/lib/api/detail-lookup";
import { dispatchApi } from "../src/lib/api/dispatch.server";

const HOSTS = [
  "kovanica.online",
  "www.kovanica.online",
  "testnet.kovanica.online",
  "mainnet.kovanica.online",
  "docs.kovanica.online",
  "api.kovanica.online",
  "playground.kovanica.online",
  "dash.kovanica.online",
  "explorer.kovanica.online",
];

const ID = "ab".repeat(32);

function directive(csp: string, name: string): string[] {
  const d = csp
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name} `));
  return d ? d.split(/\s+/).slice(1) : [];
}

function stubRpc(respond: (body: { method: string }) => Response): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method: string };
    return respond(body);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("every production host role gets HSTS, nosniff, referrer, permissions, XFO DENY and CSP", () => {
  for (const host of HOSTS) {
    const h = securityHeaders({ host, nonce: "n0nce" });
    assert.equal(h["Strict-Transport-Security"], HSTS_VALUE, host);
    assert.doesNotMatch(HSTS_VALUE, /preload/);
    assert.equal(h["X-Content-Type-Options"], "nosniff", host);
    assert.equal(h["Referrer-Policy"], "strict-origin-when-cross-origin", host);
    assert.equal(h["X-Frame-Options"], "DENY", host);
    assert.ok(h["Permissions-Policy"]?.includes("camera=()"), host);
    const csp = h["Content-Security-Policy"] ?? "";
    assert.deepEqual(directive(csp, "frame-ancestors"), ["'none'"], host);
  }
});

test("CSP allows the per-request nonce and wasm, never blanket unsafe-inline/unsafe-eval for scripts", () => {
  const csp = buildCsp({ nonce: "abc123", embeddable: false });
  const script = directive(csp, "script-src");
  assert.ok(script.includes("'nonce-abc123'"));
  assert.ok(script.includes("'wasm-unsafe-eval'"));
  assert.ok(!script.includes("'unsafe-inline'"));
  assert.ok(!script.includes("'unsafe-eval'"));
  assert.deepEqual(directive(csp, "object-src"), ["'none'"]);
  assert.ok(directive(csp, "worker-src").includes("blob:"));
});

test("only the live-preview guest host is embeddable, and then without XFO", () => {
  assert.equal(isEmbeddableHost("abc.grok-sandbox.com"), true);
  assert.equal(isEmbeddableHost("playground.kovanica.online"), false);
  const h = securityHeaders({ host: "abc.grok-sandbox.com", nonce: "x" });
  assert.equal(h["X-Frame-Options"], undefined);
  assert.ok(
    directive(h["Content-Security-Policy"] ?? "", "frame-ancestors").includes("https://*.grok.com"),
  );
});

test("dev server skips the CSP (Vite's HMR preamble is an un-nonced inline script)", () => {
  const h = securityHeaders({ host: "localhost", nonce: "x", dev: true });
  assert.equal(h["Content-Security-Policy"], undefined);
  assert.equal(h["X-Content-Type-Options"], "nosniff");
});

test("nonces are fresh base64 per call", () => {
  const a = createNonce();
  const b = createNonce();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9+/]{22}==$/);
});

test("asset ids are 32-byte hex, optionally 0x-prefixed", () => {
  assert.equal(isAssetId(ID), true);
  assert.equal(isAssetId(`0x${ID}`), true);
  assert.equal(isAssetId("nope"), false);
  assert.equal(isAssetId("zz".repeat(32)), false);
  assert.equal(isAssetId(ID.slice(2)), false);
});

test("a failed detail lookup maps to 404/501/502/503, never 500", () => {
  assert.equal(lookupFailureStatus(400), 404);
  assert.equal(lookupFailureStatus(404), 404);
  assert.equal(lookupFailureStatus(501), 501);
  assert.equal(lookupFailureStatus(503), 503);
  assert.equal(lookupFailureStatus(500), 502);
  assert.equal(lookupFailureStatus(undefined), 502);
});

for (const kind of ["nft", "rwa", "collection"] as const) {
  test(`/api/${kind}: malformed id is 400 and never reaches the node`, async () => {
    let called = false;
    const restore = stubRpc(() => {
      called = true;
      return Response.json({ jsonrpc: "2.0", id: 1, result: null });
    });
    try {
      const res = await dispatchApi(new Request(`http://x/api/${kind}/nope?source=testnet`));
      assert.equal(res.status, 400);
      assert.equal(called, false);
    } finally {
      restore();
    }
  });

  test(`/api/${kind}: unknown id is 404, unsupported lookup 501, node down 502`, async () => {
    const cases: Array<[() => Response, number]> = [
      [() => Response.json({ jsonrpc: "2.0", id: 1, result: null }), 404],
      [
        () =>
          Response.json({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32601, message: "Method not found: x" },
          }),
        501,
      ],
      [() => new Response("bad gateway", { status: 502 }), 502],
    ];
    for (const [respond, status] of cases) {
      const restore = stubRpc(respond);
      try {
        const res = await dispatchApi(new Request(`http://x/api/${kind}/${ID}?source=testnet`));
        assert.equal(res.status, status);
      } finally {
        restore();
      }
    }
  });
}

test("/api/head reports finality depth as null rather than a hardcoded 100", async () => {
  const restore = stubRpc(({ method }) => {
    if (method === "kovanica_syncStatus") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: { committedHeight: 7, peers: [] } });
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result: null });
  });
  try {
    const res = await dispatchApi(new Request("http://x/api/head?source=testnet"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { finality_depth: unknown; blocks: number };
    assert.equal(body.blocks, 7);
    assert.equal(body.finality_depth, null);
  } finally {
    restore();
  }
});
