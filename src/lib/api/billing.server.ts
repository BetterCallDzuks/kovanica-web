import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  createApiKey,
  findActiveApiKeyByReference,
  revokeApiKeysBySubscription,
  type ApiKeyTier,
} from "./api-keys.server";

export type PaymentMethod = "stripe" | "onchain";
export type OnchainAsset = "USDC" | "KVNC";
export type InvoiceStatus = "pending" | "paid" | "expired" | "cancelled";

export interface BillingPlanSpec {
  id: string;
  aliases: readonly string[];
  name: string;
  amountUsdCents: number;
  mode: "subscription" | "payment";
  tier: ApiKeyTier | null;
  stripePriceEnv: string | null;
}

export const BILLING_PLANS: readonly BillingPlanSpec[] = [
  {
    id: "rpc-builder",
    aliases: ["builder"],
    name: "Managed RPC — Builder",
    amountUsdCents: 4900,
    mode: "subscription",
    tier: "builder",
    stripePriceEnv: "STRIPE_PRICE_BUILDER",
  },
  {
    id: "rpc-scale",
    aliases: ["growth", "scale"],
    name: "Managed RPC — Scale",
    amountUsdCents: 24900,
    mode: "subscription",
    tier: "growth",
    stripePriceEnv: "STRIPE_PRICE_GROWTH",
  },
  {
    id: "rwa-launch",
    aliases: ["rwa-starter"],
    name: "RWA Issuer — Launch",
    amountUsdCents: 29900,
    mode: "subscription",
    tier: "rwa-starter",
    stripePriceEnv: "STRIPE_PRICE_RWA_STARTER",
  },
  {
    id: "rwa-institutional",
    aliases: ["rwa-enterprise"],
    name: "RWA Issuer — Institutional Compliance",
    amountUsdCents: 99900,
    mode: "subscription",
    tier: "rwa-enterprise",
    stripePriceEnv: "STRIPE_PRICE_RWA_ENTERPRISE",
  },
  {
    id: "verified-token",
    aliases: [],
    name: "Verified Token Listing",
    amountUsdCents: 25000,
    mode: "payment",
    tier: null,
    stripePriceEnv: "STRIPE_PRICE_VERIFIED_TOKEN",
  },
  {
    id: "verified-rwa",
    aliases: [],
    name: "Verified RWA Issuer Badge",
    amountUsdCents: 50000,
    mode: "payment",
    tier: null,
    stripePriceEnv: "STRIPE_PRICE_VERIFIED_RWA",
  },
  {
    id: "surface-sponsor",
    aliases: ["sponsor"],
    name: "Privacy-First Surface Sponsorship",
    amountUsdCents: 40000,
    mode: "subscription",
    tier: null,
    stripePriceEnv: "STRIPE_PRICE_SPONSOR",
  },
];

export interface InvoiceRecord {
  id: string;
  plan_id: string;
  plan_name: string;
  tier: ApiKeyTier | null;
  payment_method: PaymentMethod;
  asset: OnchainAsset | "USD";
  amount_usd_cents: number;
  amount_usd: string;
  amount_asset: string;
  treasury_address: string | null;
  treasury_configured: boolean;
  memo: string;
  status: InvoiceStatus;
  customer_email: string | null;
  organization: string | null;
  stripe_session_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  api_key_id: string | null;
  api_key_prefix: string | null;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
}

export interface PublicInvoice {
  id: string;
  plan_id: string;
  plan_name: string;
  tier: ApiKeyTier | null;
  payment_method: PaymentMethod;
  asset: OnchainAsset | "USD";
  amount_usd: string;
  amount_asset: string;
  treasury_address: string | null;
  treasury_configured: boolean;
  memo: string;
  status: InvoiceStatus;
  api_key_prefix: string | null;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
}

const DEFAULT_TREASURY_PLACEHOLDER =
  "kvnc1treasury00000000000000000000000000000000000000000000000000dag";
const DEFAULT_INVOICE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WEBHOOK_TOLERANCE_SEC = 300;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INVOICE_ID_RE = /^inv_[a-f0-9]{16}$/;

export function resolveInvoicesFilePath(): string {
  const envPath = process.env.KOVANICA_INVOICES_FILE?.trim();
  if (envPath) return resolve(envPath);
  return resolve(process.cwd(), "data/invoices.jsonl");
}

export function findBillingPlan(rawPlanId: string): BillingPlanSpec | null {
  const normalized = rawPlanId.trim().toLowerCase();
  for (const plan of BILLING_PLANS) {
    if (plan.id === normalized || plan.aliases.includes(normalized)) {
      return plan;
    }
  }
  return null;
}

export function resolveTreasuryAddress(): { address: string; configured: boolean } {
  const configured = process.env.BILLING_TREASURY_ADDRESS?.trim();
  if (configured && configured.length > 0) {
    return { address: configured, configured: true };
  }
  return { address: DEFAULT_TREASURY_PLACEHOLDER, configured: false };
}

function resolveKvncUsdRate(): number {
  const raw = process.env.BILLING_KVNC_USD_RATE?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0.1; // Indicative $0.10/KVNC when BILLING_KVNC_USD_RATE is unset
}

export function computeDeterministicInvoiceId(seed: {
  planId: string;
  paymentMethod: PaymentMethod;
  asset: string;
  email: string;
  idempotencyKey: string;
}): string {
  const preimage = [
    "kvnc-invoice-v1",
    seed.planId,
    seed.paymentMethod,
    seed.asset,
    seed.email.toLowerCase(),
    seed.idempotencyKey,
  ].join("|");
  const digest = createHash("sha256").update(preimage, "utf8").digest("hex");
  return `inv_${digest.slice(0, 16)}`;
}

async function readAllInvoices(): Promise<Map<string, InvoiceRecord>> {
  const byId = new Map<string, InvoiceRecord>();
  const filePath = resolveInvoicesFilePath();
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return byId;
    throw err;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as InvoiceRecord;
      if (rec && typeof rec.id === "string") {
        byId.set(rec.id, rec);
      }
    } catch {
      // Ignore malformed lines
    }
  }
  return byId;
}

async function appendInvoiceRecord(record: InvoiceRecord): Promise<void> {
  const filePath = resolveInvoicesFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export function toPublicInvoice(record: InvoiceRecord, now = Date.now()): PublicInvoice {
  let effectiveStatus = record.status;
  if (effectiveStatus === "pending" && Date.parse(record.expires_at) < now) {
    effectiveStatus = "expired";
  }
  return {
    id: record.id,
    plan_id: record.plan_id,
    plan_name: record.plan_name,
    tier: record.tier,
    payment_method: record.payment_method,
    asset: record.asset,
    amount_usd: record.amount_usd,
    amount_asset: record.amount_asset,
    treasury_address: record.treasury_address,
    treasury_configured: record.treasury_configured,
    memo: record.memo,
    status: effectiveStatus,
    api_key_prefix: record.api_key_prefix,
    created_at: record.created_at,
    expires_at: record.expires_at,
    paid_at: record.paid_at,
  };
}

export async function getInvoiceById(id: string): Promise<InvoiceRecord | null> {
  if (!INVOICE_ID_RE.test(id)) return null;
  const map = await readAllInvoices();
  return map.get(id) ?? null;
}

/**
 * Verify Stripe `Stripe-Signature` header (HMAC-SHA256 with constant-time compare + replay window).
 */
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  opts?: { nowSec?: number; toleranceSec?: number },
): { ok: true; timestamp: number } | { ok: false; error: string } {
  if (!webhookSecret || webhookSecret.trim().length === 0) {
    return { ok: false, error: "Webhook secret is not configured." };
  }
  if (!signatureHeader || signatureHeader.trim().length === 0) {
    return { ok: false, error: "Missing Stripe-Signature header." };
  }

  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of signatureHeader.split(",")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key === "t" && /^\d+$/.test(val)) {
      timestamp = Number(val);
    } else if (key === "v1" && /^[a-f0-9]{64}$/i.test(val)) {
      signatures.push(val.toLowerCase());
    }
  }

  if (timestamp === null || signatures.length === 0) {
    return { ok: false, error: "Malformed Stripe-Signature header." };
  }

  const nowSec = opts?.nowSec ?? Math.floor(Date.now() / 1000);
  const toleranceSec = opts?.toleranceSec ?? DEFAULT_WEBHOOK_TOLERANCE_SEC;
  if (Math.abs(nowSec - timestamp) > toleranceSec) {
    return { ok: false, error: "Stripe-Signature timestamp outside tolerance window." };
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedHex = createHmac("sha256", webhookSecret.trim())
    .update(signedPayload, "utf8")
    .digest("hex");
  const expectedBuf = Buffer.from(expectedHex, "hex");

  for (const sig of signatures) {
    const providedBuf = Buffer.from(sig, "hex");
    if (providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf)) {
      return { ok: true, timestamp };
    }
  }

  return { ok: false, error: "Invalid Stripe-Signature HMAC digest." };
}

function sanitizeRedirectUrl(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return parsed.toString();
    }
  } catch {
    // fallback
  }
  return fallback;
}

export async function handleBillingCheckout(
  req: Request,
  fetchFn: typeof fetch = fetch,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let payload: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 16_384) {
      return { status: 413, body: { ok: false, error: "Request body too large." } };
    }
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { ok: false, error: "Invalid JSON body." } };
  }

  const rawPlanId =
    typeof payload.planId === "string"
      ? payload.planId
      : typeof payload.plan_id === "string"
        ? payload.plan_id
        : "";
  const plan = findBillingPlan(rawPlanId);
  if (!plan) {
    return {
      status: 400,
      body: {
        ok: false,
        error: `Unknown or custom plan '${rawPlanId}'. Use a self-serve plan ID or submit an enterprise inquiry.`,
      },
    };
  }

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (email.length > 0 && !EMAIL_RE.test(email)) {
    return { status: 400, body: { ok: false, error: "Invalid email address." } };
  }

  const organization =
    typeof payload.organization === "string"
      ? payload.organization.replace(/[\r\n\t]+/g, " ").trim().slice(0, 160) || null
      : null;

  const requestedMethod =
    payload.paymentMethod === "onchain" || payload.payment_method === "onchain"
      ? "onchain"
      : payload.paymentMethod === "stripe" || payload.payment_method === "stripe"
        ? "stripe"
        : process.env.STRIPE_SECRET_KEY?.trim()
          ? "stripe"
          : "onchain";

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const effectiveMethod: PaymentMethod =
    requestedMethod === "stripe" && stripeSecret.length > 0 ? "stripe" : "onchain";

  const requestedAsset: OnchainAsset =
    String(payload.asset ?? "USDC").toUpperCase() === "KVNC" ? "KVNC" : "USDC";

  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + DEFAULT_INVOICE_TTL_MS).toISOString();
  const hourBucket = Math.floor(now / (60 * 60 * 1000));
  const idempotencyKey =
    typeof payload.idempotencyKey === "string" && payload.idempotencyKey.trim().length > 0
      ? payload.idempotencyKey.trim().slice(0, 128)
      : `bucket:${hourBucket}`;

  const invoiceId = computeDeterministicInvoiceId({
    planId: plan.id,
    paymentMethod: effectiveMethod,
    asset: effectiveMethod === "stripe" ? "USD" : requestedAsset,
    email,
    idempotencyKey,
  });

  const amountUsd = (plan.amountUsdCents / 100).toFixed(2);

  if (effectiveMethod === "stripe") {
    const reqUrl = new URL(req.url);
    const origin = `${reqUrl.protocol}//${reqUrl.host}`;
    const successUrl = sanitizeRedirectUrl(
      payload.successUrl,
      `${origin}/pricing?checkout=success&invoice=${invoiceId}`,
    );
    const cancelUrl = sanitizeRedirectUrl(
      payload.cancelUrl,
      `${origin}/pricing?checkout=cancelled&invoice=${invoiceId}`,
    );

    const form = new URLSearchParams();
    form.set("mode", plan.mode);
    form.set("success_url", successUrl);
    form.set("cancel_url", cancelUrl);
    form.set("client_reference_id", invoiceId);
    form.set("metadata[invoice_id]", invoiceId);
    form.set("metadata[plan_id]", plan.id);
    if (plan.tier) form.set("metadata[tier]", plan.tier);
    if (organization) form.set("metadata[organization]", organization);
    if (email) form.set("customer_email", email);

    const configuredPriceId = plan.stripePriceEnv ? process.env[plan.stripePriceEnv]?.trim() : "";
    if (configuredPriceId) {
      form.set("line_items[0][price]", configuredPriceId);
      form.set("line_items[0][quantity]", "1");
    } else {
      form.set("line_items[0][price_data][currency]", "usd");
      form.set("line_items[0][price_data][unit_amount]", String(plan.amountUsdCents));
      form.set("line_items[0][price_data][product_data][name]", plan.name);
      if (plan.mode === "subscription") {
        form.set("line_items[0][price_data][recurring][interval]", "month");
      }
      form.set("line_items[0][quantity]", "1");
    }

    let stripeRes: Response;
    try {
      stripeRes = await fetchFn("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${stripeSecret}`,
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": invoiceId,
        },
        body: form.toString(),
      });
    } catch {
      return {
        status: 502,
        body: { ok: false, error: "Could not reach Stripe Checkout API." },
      };
    }

    const stripeData = (await stripeRes.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!stripeRes.ok || !stripeData.id || !stripeData.url) {
      return {
        status: 502,
        body: {
          ok: false,
          error: stripeData.error?.message ?? "Stripe Checkout session creation failed.",
        },
      };
    }

    const record: InvoiceRecord = {
      id: invoiceId,
      plan_id: plan.id,
      plan_name: plan.name,
      tier: plan.tier,
      payment_method: "stripe",
      asset: "USD",
      amount_usd_cents: plan.amountUsdCents,
      amount_usd: amountUsd,
      amount_asset: `${amountUsd} USD`,
      treasury_address: null,
      treasury_configured: false,
      memo: invoiceId,
      status: "pending",
      customer_email: email || null,
      organization,
      stripe_session_id: stripeData.id,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      api_key_id: null,
      api_key_prefix: null,
      created_at: createdAt,
      expires_at: expiresAt,
      paid_at: null,
    };
    await appendInvoiceRecord(record);

    return {
      status: 201,
      body: {
        ok: true,
        mode: "stripe",
        checkout_url: stripeData.url,
        session_id: stripeData.id,
        invoice: toPublicInvoice(record, now),
      },
    };
  }

  // On-chain KVNC/USDC invoice path
  const treasury = resolveTreasuryAddress();
  const amountAsset =
    requestedAsset === "KVNC"
      ? `${(plan.amountUsdCents / 100 / resolveKvncUsdRate()).toFixed(2)} KVNC`
      : `${amountUsd} USDC`;

  const record: InvoiceRecord = {
    id: invoiceId,
    plan_id: plan.id,
    plan_name: plan.name,
    tier: plan.tier,
    payment_method: "onchain",
    asset: requestedAsset,
    amount_usd_cents: plan.amountUsdCents,
    amount_usd: amountUsd,
    amount_asset: amountAsset,
    treasury_address: treasury.address,
    treasury_configured: treasury.configured,
    memo: invoiceId,
    status: "pending",
    customer_email: email || null,
    organization,
    stripe_session_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    api_key_id: null,
    api_key_prefix: null,
    created_at: createdAt,
    expires_at: expiresAt,
    paid_at: null,
  };
  await appendInvoiceRecord(record);

  return {
    status: 201,
    body: {
      ok: true,
      mode: "onchain",
      stripe_fallback: requestedMethod === "stripe",
      invoice: toPublicInvoice(record, now),
    },
  };
}

export async function handleStripeWebhook(
  req: Request,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) {
    return {
      status: 503,
      body: { ok: false, error: "Stripe webhook secret is not configured." },
    };
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("stripe-signature");
  const verification = verifyStripeWebhookSignature(rawBody, sigHeader, secret);
  if (!verification.ok) {
    return { status: 400, body: { ok: false, error: verification.error } };
  }

  let event: {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
  } catch {
    return { status: 400, body: { ok: false, error: "Invalid webhook JSON payload." } };
  }

  const eventType = event.type ?? "";
  const obj = event.data?.object ?? {};

  if (eventType === "checkout.session.completed") {
    const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
    const invoiceId =
      typeof metadata.invoice_id === "string"
        ? metadata.invoice_id
        : typeof obj.client_reference_id === "string"
          ? obj.client_reference_id
          : null;
    const planId = typeof metadata.plan_id === "string" ? metadata.plan_id : "";
    const plan = findBillingPlan(planId);
    const tier = (typeof metadata.tier === "string" ? metadata.tier : plan?.tier ?? null) as
      | ApiKeyTier
      | null;
    const customerId = typeof obj.customer === "string" ? obj.customer : null;
    const subscriptionId = typeof obj.subscription === "string" ? obj.subscription : null;
    const customerDetails = obj.customer_details as { email?: string } | undefined;
    const customerEmail =
      typeof obj.customer_email === "string"
        ? obj.customer_email
        : typeof customerDetails?.email === "string"
          ? customerDetails.email
          : null;

    let apiKeyId: string | null = null;
    let apiKeyPrefix: string | null = null;

    if (tier) {
      const existing = await findActiveApiKeyByReference({ invoiceId, subscriptionId });
      if (existing) {
        apiKeyId = existing.id;
        apiKeyPrefix = existing.key_prefix;
      } else {
        const created = await createApiKey({
          tier,
          mode: process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ? "test" : "live",
          label: plan?.name ?? `Stripe ${tier}`,
          owner_email: customerEmail,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          invoice_id: invoiceId,
        });
        apiKeyId = created.record.id;
        apiKeyPrefix = created.record.key_prefix;
      }
    }

    if (invoiceId) {
      const existingInvoice = await getInvoiceById(invoiceId);
      const nowIso = new Date().toISOString();
      if (existingInvoice) {
        await appendInvoiceRecord({
          ...existingInvoice,
          status: "paid",
          paid_at: nowIso,
          stripe_customer_id: customerId ?? existingInvoice.stripe_customer_id,
          stripe_subscription_id: subscriptionId ?? existingInvoice.stripe_subscription_id,
          api_key_id: apiKeyId ?? existingInvoice.api_key_id,
          api_key_prefix: apiKeyPrefix ?? existingInvoice.api_key_prefix,
        });
      }
    }

    return {
      status: 200,
      body: {
        ok: true,
        received: true,
        event_type: eventType,
        action: tier ? "provisioned_api_key" : "marked_paid",
        api_key_id: apiKeyId,
        api_key_prefix: apiKeyPrefix,
      },
    };
  }

  if (eventType === "customer.subscription.deleted") {
    const subscriptionId = typeof obj.id === "string" ? obj.id : "";
    const customerId = typeof obj.customer === "string" ? obj.customer : null;
    const revokedCount = await revokeApiKeysBySubscription(subscriptionId, customerId);
    return {
      status: 200,
      body: {
        ok: true,
        received: true,
        event_type: eventType,
        action: "revoked_api_keys",
        revoked_count: revokedCount,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      received: true,
      event_type: eventType,
      action: "ignored",
    },
  };
}

export async function handleInvoiceLookup(
  invoiceId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!INVOICE_ID_RE.test(invoiceId)) {
    return { status: 400, body: { ok: false, error: "Invalid invoice ID format." } };
  }
  const record = await getInvoiceById(invoiceId);
  if (!record) {
    return { status: 404, body: { ok: false, error: "Invoice not found." } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      invoice: toPublicInvoice(record),
    },
  };
}

export async function handleBillingRequest(
  req: Request,
  pathname: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const method = req.method.toUpperCase();
  const sub = pathname.replace(/^\/api\/billing\/?/, "").replace(/\/$/, "");

  if (sub === "checkout") {
    if (method !== "POST") {
      return { status: 405, body: { ok: false, error: "Method not allowed." } };
    }
    return handleBillingCheckout(req);
  }

  if (sub === "webhook") {
    if (method !== "POST") {
      return { status: 405, body: { ok: false, error: "Method not allowed." } };
    }
    return handleStripeWebhook(req);
  }

  if (sub.startsWith("invoice/")) {
    if (method !== "GET") {
      return { status: 405, body: { ok: false, error: "Method not allowed." } };
    }
    const id = sub.slice("invoice/".length);
    return handleInvoiceLookup(id);
  }

  return { status: 404, body: { ok: false, error: "Unknown billing endpoint." } };
}
