import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkApiRateLimit,
  createApiKey,
  handleApiKeysRequest,
  listApiKeys,
  lookupApiKeyByPlaintext,
  resetApiRateLimitForTests,
} from "../src/lib/api/api-keys.server";
import {
  handleBillingCheckout,
  handleInvoiceLookup,
  handleStripeWebhook,
  verifyStripeWebhookSignature,
} from "../src/lib/api/billing.server";
import { dispatchApi } from "../src/lib/api/dispatch.server";

function signStripePayload(rawBody: string, secret: string, timestampSec: number): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestampSec}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestampSec},v1=${digest}`;
}

test("verifyStripeWebhookSignature validates HMAC-SHA256, rejects tampering, and enforces replay tolerance", () => {
  const secret = "whsec_test_secret_123456";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const nowSec = 1_750_000_000;

  // Valid signature
  const validSig = signStripePayload(body, secret, nowSec - 10);
  const ok = verifyStripeWebhookSignature(body, validSig, secret, { nowSec });
  assert.equal(ok.ok, true);

  // Tampered body -> rejected
  const tampered = verifyStripeWebhookSignature(`${body} `, validSig, secret, { nowSec });
  assert.equal(tampered.ok, false);

  // Wrong secret -> rejected
  const wrongSecret = verifyStripeWebhookSignature(body, validSig, "whsec_other", { nowSec });
  assert.equal(wrongSecret.ok, false);

  // Expired timestamp (> 300s old) -> rejected (replay protection)
  const staleSig = signStripePayload(body, secret, nowSec - 600);
  const stale = verifyStripeWebhookSignature(body, staleSig, secret, { nowSec });
  assert.equal(stale.ok, false);

  // Malformed header -> rejected
  const badHeader = verifyStripeWebhookSignature(body, "v1=nothex", secret, { nowSec });
  assert.equal(badHeader.ok, false);
});

test("on-chain invoice creation is deterministic, supports USDC/KVNC, and hides PII on lookup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kovanica-billing-"));
  const invFile = join(dir, "invoices.jsonl");
  const prevInv = process.env.KOVANICA_INVOICES_FILE;
  const prevStripe = process.env.STRIPE_SECRET_KEY;
  const prevTreasury = process.env.BILLING_TREASURY_ADDRESS;

  process.env.KOVANICA_INVOICES_FILE = invFile;
  delete process.env.STRIPE_SECRET_KEY;
  process.env.BILLING_TREASURY_ADDRESS = "kvnc1customtreasuryaddress000000000000000000000000000000000dag";

  try {
    const body = {
      planId: "rpc-builder",
      paymentMethod: "onchain",
      asset: "USDC",
      email: "buyer@example.com",
      idempotencyKey: "order-001",
    };

    const res1 = await handleBillingCheckout(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(res1.status, 201);
    assert.equal(res1.body.ok, true);
    assert.equal(res1.body.mode, "onchain");
    const inv1 = res1.body.invoice as Record<string, unknown>;
    assert.match(String(inv1.id), /^inv_[a-f0-9]{16}$/);
    assert.equal(inv1.amount_usd, "49.00");
    assert.equal(inv1.amount_asset, "49.00 USDC");
    assert.equal(inv1.treasury_configured, true);
    assert.equal(
      inv1.treasury_address,
      "kvnc1customtreasuryaddress000000000000000000000000000000000dag",
    );
    assert.equal("customer_email" in inv1, false, "Public invoice must not expose email PII");

    // Deterministic ID on retry with same idempotencyKey
    const res2 = await handleBillingCheckout(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    assert.equal((res2.body.invoice as Record<string, unknown>).id, inv1.id);

    // KVNC invoice + Stripe fallback when STRIPE_SECRET_KEY is unset
    const kvncRes = await handleBillingCheckout(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: "rwa-starter",
          paymentMethod: "stripe",
          asset: "KVNC",
          idempotencyKey: "order-002",
        }),
      }),
    );
    assert.equal(kvncRes.status, 201);
    assert.equal(kvncRes.body.mode, "onchain");
    assert.equal(kvncRes.body.stripe_fallback, true);
    assert.equal((kvncRes.body.invoice as Record<string, unknown>).amount_asset, "2990.00 KVNC");

    // GET /api/billing/invoice/:id lookup
    const lookup = await handleInvoiceLookup(String(inv1.id));
    assert.equal(lookup.status, 200);
    assert.equal((lookup.body.invoice as Record<string, unknown>).status, "pending");
    assert.equal("customer_email" in (lookup.body.invoice as Record<string, unknown>), false);

    // Invalid ID -> 400; unknown valid-format ID -> 404
    assert.equal((await handleInvoiceLookup("bad-id")).status, 400);
    assert.equal((await handleInvoiceLookup("inv_0000000000000000")).status, 404);
  } finally {
    if (prevInv === undefined) delete process.env.KOVANICA_INVOICES_FILE;
    else process.env.KOVANICA_INVOICES_FILE = prevInv;
    if (prevStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prevStripe;
    if (prevTreasury === undefined) delete process.env.BILLING_TREASURY_ADDRESS;
    else process.env.BILLING_TREASURY_ADDRESS = prevTreasury;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Stripe checkout + webhook provisions API key on checkout.session.completed and revokes on subscription.deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kovanica-stripe-"));
  const invFile = join(dir, "invoices.jsonl");
  const keysFile = join(dir, "api-keys.jsonl");
  const prevInv = process.env.KOVANICA_INVOICES_FILE;
  const prevKeys = process.env.KOVANICA_API_KEYS_FILE;
  const prevStripe = process.env.STRIPE_SECRET_KEY;
  const prevWhsec = process.env.STRIPE_WEBHOOK_SECRET;

  process.env.KOVANICA_INVOICES_FILE = invFile;
  process.env.KOVANICA_API_KEYS_FILE = keysFile;
  process.env.STRIPE_SECRET_KEY = "sk_test_mock_key";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_mock_webhook_secret";

  try {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          id: "cs_test_123",
          url: "https://checkout.stripe.com/c/pay/cs_test_123",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const checkout = await handleBillingCheckout(
      new Request("https://kovanica.online/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: "rpc-builder",
          paymentMethod: "stripe",
          email: "dev@acme.io",
          idempotencyKey: "stripe-order-1",
        }),
      }),
      mockFetch,
    );
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.mode, "stripe");
    assert.equal(checkout.body.checkout_url, "https://checkout.stripe.com/c/pay/cs_test_123");
    const invoiceId = String((checkout.body.invoice as Record<string, unknown>).id);

    // Send signed checkout.session.completed webhook
    const completedPayload = JSON.stringify({
      id: "evt_complete_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          customer: "cus_123",
          subscription: "sub_123",
          customer_email: "dev@acme.io",
          metadata: {
            invoice_id: invoiceId,
            plan_id: "rpc-builder",
            tier: "builder",
          },
        },
      },
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const whRes = await handleStripeWebhook(
      new Request("https://kovanica.online/api/billing/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(
            completedPayload,
            process.env.STRIPE_WEBHOOK_SECRET,
            nowSec,
          ),
        },
        body: completedPayload,
      }),
    );
    assert.equal(whRes.status, 200);
    assert.equal(whRes.body.action, "provisioned_api_key");
    assert.ok(typeof whRes.body.api_key_id === "string");

    // Invoice is now marked paid
    const invLookup = await handleInvoiceLookup(invoiceId);
    assert.equal((invLookup.body.invoice as Record<string, unknown>).status, "paid");

    // Active API key exists
    const keysAfterProvision = await listApiKeys();
    assert.equal(keysAfterProvision.length, 1);
    assert.equal(keysAfterProvision[0]?.tier, "builder");
    assert.equal(keysAfterProvision[0]?.status, "active");

    // Send signed customer.subscription.deleted webhook -> auto-revokes key
    const cancelPayload = JSON.stringify({
      id: "evt_cancel_1",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_123",
        },
      },
    });
    const cancelRes = await handleStripeWebhook(
      new Request("https://kovanica.online/api/billing/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(
            cancelPayload,
            process.env.STRIPE_WEBHOOK_SECRET,
            nowSec,
          ),
        },
        body: cancelPayload,
      }),
    );
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.revoked_count, 1);

    const keysAfterCancel = await listApiKeys();
    assert.equal(keysAfterCancel[0]?.status, "revoked");
  } finally {
    if (prevInv === undefined) delete process.env.KOVANICA_INVOICES_FILE;
    else process.env.KOVANICA_INVOICES_FILE = prevInv;
    if (prevKeys === undefined) delete process.env.KOVANICA_API_KEYS_FILE;
    else process.env.KOVANICA_API_KEYS_FILE = prevKeys;
    if (prevStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prevStripe;
    if (prevWhsec === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevWhsec;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("API key admin endpoints enforce BILLING_ADMIN_TOKEN, hash keys (never store plaintext), and support revocation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kovanica-keys-"));
  const keysFile = join(dir, "api-keys.jsonl");
  const prevKeys = process.env.KOVANICA_API_KEYS_FILE;
  const prevAdmin = process.env.BILLING_ADMIN_TOKEN;
  process.env.KOVANICA_API_KEYS_FILE = keysFile;
  delete process.env.BILLING_ADMIN_TOKEN;

  try {
    // Unconfigured admin token -> fail-closed 503
    const disabled = await handleApiKeysRequest(
      new Request("http://localhost/api/keys", { method: "GET" }),
      "/api/keys",
    );
    assert.equal(disabled.status, 503);

    process.env.BILLING_ADMIN_TOKEN = "super-secret-admin-token";

    // Missing or wrong token -> 401
    const unauth = await handleApiKeysRequest(
      new Request("http://localhost/api/keys", {
        method: "GET",
        headers: { authorization: "Bearer wrong-token" },
      }),
      "/api/keys",
    );
    assert.equal(unauth.status, 401);

    // Issue key -> 201 with plaintext shown once
    const issued = await handleApiKeysRequest(
      new Request("http://localhost/api/keys", {
        method: "POST",
        headers: {
          authorization: "Bearer super-secret-admin-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ tier: "growth", label: "DEX Indexer" }),
      }),
      "/api/keys",
    );
    assert.equal(issued.status, 201);
    const plaintext = String(issued.body.api_key);
    assert.match(plaintext, /^kvnc_live_[a-f0-9]{48}$/);
    const keyMeta = issued.body.key as Record<string, unknown>;
    assert.equal(keyMeta.tier, "growth");
    assert.equal(keyMeta.rpm_limit, 3000);

    // Verify plaintext is NEVER persisted on disk
    const rawDisk = readFileSync(keysFile, "utf8");
    assert.equal(rawDisk.includes(plaintext), false, "Plaintext API key must never be persisted!");

    // Lookup by plaintext succeeds
    const found = await lookupApiKeyByPlaintext(plaintext);
    assert.ok(found);
    assert.equal(found.id, keyMeta.id);

    // GET /api/keys lists metadata without plaintext or hash
    const listed = await handleApiKeysRequest(
      new Request("http://localhost/api/keys", {
        method: "GET",
        headers: { authorization: "Bearer super-secret-admin-token" },
      }),
      "/api/keys",
    );
    assert.equal(listed.status, 200);
    const keys = listed.body.keys as Array<Record<string, unknown>>;
    assert.equal(keys.length, 1);
    assert.equal("key_hash" in keys[0]!, false);

    // DELETE /api/keys/:id revokes key
    const del = await handleApiKeysRequest(
      new Request(`http://localhost/api/keys/${keyMeta.id}`, {
        method: "DELETE",
        headers: { authorization: "Bearer super-secret-admin-token" },
      }),
      `/api/keys/${keyMeta.id}`,
    );
    assert.equal(del.status, 200);
    assert.equal((del.body.key as Record<string, unknown>).status, "revoked");
  } finally {
    if (prevKeys === undefined) delete process.env.KOVANICA_API_KEYS_FILE;
    else process.env.KOVANICA_API_KEYS_FILE = prevKeys;
    if (prevAdmin === undefined) delete process.env.BILLING_ADMIN_TOKEN;
    else process.env.BILLING_ADMIN_TOKEN = prevAdmin;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tiered rate limiter emits X-RateLimit-* headers, enforces limits, and gracefully falls back for unauthenticated calls", async () => {
  resetApiRateLimitForTests();
  const dir = mkdtempSync(join(tmpdir(), "kovanica-rl-"));
  const keysFile = join(dir, "api-keys.jsonl");
  const prevKeys = process.env.KOVANICA_API_KEYS_FILE;
  const prevPublicRpm = process.env.API_PUBLIC_RPM;
  process.env.KOVANICA_API_KEYS_FILE = keysFile;
  process.env.API_PUBLIC_RPM = "2";

  try {
    // Public fallback: 2 allowed, 3rd returns 429
    const r1 = await dispatchApi(new Request("http://localhost/api/head?source=local"));
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get("x-ratelimit-limit"), "2");
    assert.equal(r1.headers.get("x-ratelimit-remaining"), "1");
    assert.equal(r1.headers.get("x-ratelimit-tier"), "public");
    assert.ok(Number(r1.headers.get("x-ratelimit-reset")) > 0);

    const r2 = await dispatchApi(new Request("http://localhost/api/head?source=local"));
    assert.equal(r2.status, 200);
    assert.equal(r2.headers.get("x-ratelimit-remaining"), "0");

    const r3 = await dispatchApi(new Request("http://localhost/api/head?source=local"));
    assert.equal(r3.status, 429);
    assert.ok(Number(r3.headers.get("retry-after")) >= 1);

    // Authenticated builder key gets its own 600 RPM bucket even while public IP is throttled
    const { key: builderKey } = await createApiKey({ tier: "builder", label: "Test Builder" });
    const authed = await dispatchApi(
      new Request("http://localhost/api/head?source=local", {
        headers: { "x-api-key": builderKey },
      }),
    );
    assert.equal(authed.status, 200);
    assert.equal(authed.headers.get("x-ratelimit-limit"), "600");
    assert.equal(authed.headers.get("x-ratelimit-remaining"), "599");
    assert.equal(authed.headers.get("x-ratelimit-tier"), "builder");

    // Invalid API key explicitly supplied -> 401
    const badKey = await checkApiRateLimit(
      new Request("http://localhost/api/head?source=local", {
        headers: { authorization: "Bearer kvnc_live_000000000000000000000000000000000000000000000000" },
      }),
      "127.0.0.1",
    );
    assert.equal(badKey.allowed, false);
    assert.equal(badKey.status, 401);
  } finally {
    resetApiRateLimitForTests();
    if (prevKeys === undefined) delete process.env.KOVANICA_API_KEYS_FILE;
    else process.env.KOVANICA_API_KEYS_FILE = prevKeys;
    if (prevPublicRpm === undefined) delete process.env.API_PUBLIC_RPM;
    else process.env.API_PUBLIC_RPM = prevPublicRpm;
    rmSync(dir, { recursive: true, force: true });
  }
});
