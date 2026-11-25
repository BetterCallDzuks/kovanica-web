import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";

export type ApiKeyTier =
  | "free"
  | "builder"
  | "growth"
  | "enterprise"
  | "rwa-starter"
  | "rwa-enterprise";

export interface TierLimits {
  tier: ApiKeyTier;
  rpm: number;
  monthlyQuota: number;
}

export const API_KEY_TIER_CONFIG: Record<ApiKeyTier, TierLimits> = {
  free: { tier: "free", rpm: 60, monthlyQuota: 100_000 },
  builder: { tier: "builder", rpm: 600, monthlyQuota: 5_000_000 },
  growth: { tier: "growth", rpm: 3_000, monthlyQuota: 25_000_000 },
  enterprise: { tier: "enterprise", rpm: 10_000, monthlyQuota: 250_000_000 },
  "rwa-starter": { tier: "rwa-starter", rpm: 1_200, monthlyQuota: 10_000_000 },
  "rwa-enterprise": { tier: "rwa-enterprise", rpm: 5_000, monthlyQuota: 100_000_000 },
};

export const VALID_API_KEY_TIERS = new Set<ApiKeyTier>(
  Object.keys(API_KEY_TIER_CONFIG) as ApiKeyTier[],
);

export interface ApiKeyRecord {
  id: string;
  key_hash: string;
  key_prefix: string;
  tier: ApiKeyTier;
  rpm_limit: number;
  monthly_quota: number;
  status: "active" | "revoked";
  label: string | null;
  owner_email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  invoice_id: string | null;
  created_at: string;
  revoked_at: string | null;
}

export type PublicApiKeyRecord = Omit<ApiKeyRecord, "key_hash">;

export interface CreateApiKeyInput {
  tier: ApiKeyTier;
  mode?: "live" | "test";
  label?: string | null;
  owner_email?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  invoice_id?: string | null;
}

export interface RateLimitResult {
  allowed: boolean;
  status?: number;
  body?: Record<string, unknown>;
  headers: Record<string, string>;
  tier: ApiKeyTier | "public";
  keyId: string | null;
}

const RATE_WINDOW_MS = 60_000;
const DEFAULT_PUBLIC_RPM = 300;
const rateBuckets = new Map<string, number[]>();

export function resolveApiKeysFilePath(): string {
  const envPath = process.env.KOVANICA_API_KEYS_FILE?.trim();
  if (envPath) return resolve(envPath);
  return resolve(process.cwd(), "data/api-keys.jsonl");
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function toPublicApiKeyRecord(record: ApiKeyRecord): PublicApiKeyRecord {
  const { key_hash: _hash, ...rest } = record;
  return rest;
}

export function constantTimeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify admin Bearer token using constant-time comparison.
 * Fail-closed: if BILLING_ADMIN_TOKEN is unset, admin API is disabled (503).
 */
export function verifyBillingAdminAuth(
  req: Request,
): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.BILLING_ADMIN_TOKEN?.trim();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "Admin API is disabled (BILLING_ADMIN_TOKEN not configured).",
    };
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const provided = match?.[1]?.trim() ?? "";
  if (!provided || !constantTimeEqualString(provided, expected)) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }
  return { ok: true };
}

async function readAllApiKeyRecords(): Promise<Map<string, ApiKeyRecord>> {
  const byId = new Map<string, ApiKeyRecord>();
  const filePath = resolveApiKeysFilePath();
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
      const rec = JSON.parse(trimmed) as ApiKeyRecord;
      if (rec && typeof rec.id === "string" && typeof rec.key_hash === "string") {
        byId.set(rec.id, rec);
      }
    } catch {
      // Ignore malformed trailing lines
    }
  }
  return byId;
}

async function appendApiKeyRecord(record: ApiKeyRecord): Promise<void> {
  const filePath = resolveApiKeysFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function cleanOptionalString(val: unknown, maxLen: number): string | null {
  if (typeof val !== "string") return null;
  const cleaned = val.replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

export async function createApiKey(
  input: CreateApiKeyInput,
): Promise<{ key: string; record: ApiKeyRecord; publicRecord: PublicApiKeyRecord }> {
  const limits = API_KEY_TIER_CONFIG[input.tier];
  const prefix = input.mode === "test" ? "kvnc_test_" : "kvnc_live_";
  const secretPart = randomBytes(24).toString("hex");
  const plaintext = `${prefix}${secretPart}`;
  const record: ApiKeyRecord = {
    id: `key_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    key_hash: hashApiKey(plaintext),
    key_prefix: plaintext.slice(0, prefix.length + 6),
    tier: limits.tier,
    rpm_limit: limits.rpm,
    monthly_quota: limits.monthlyQuota,
    status: "active",
    label: cleanOptionalString(input.label, 120),
    owner_email: cleanOptionalString(input.owner_email, 200),
    stripe_customer_id: cleanOptionalString(input.stripe_customer_id, 120),
    stripe_subscription_id: cleanOptionalString(input.stripe_subscription_id, 120),
    invoice_id: cleanOptionalString(input.invoice_id, 120),
    created_at: new Date().toISOString(),
    revoked_at: null,
  };
  await appendApiKeyRecord(record);
  return { key: plaintext, record, publicRecord: toPublicApiKeyRecord(record) };
}

export async function listApiKeys(): Promise<PublicApiKeyRecord[]> {
  const map = await readAllApiKeyRecords();
  return Array.from(map.values())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(toPublicApiKeyRecord);
}

export async function lookupApiKeyByPlaintext(plaintext: string): Promise<ApiKeyRecord | null> {
  if (!plaintext.startsWith("kvnc_live_") && !plaintext.startsWith("kvnc_test_")) {
    return null;
  }
  const targetHash = hashApiKey(plaintext);
  const map = await readAllApiKeyRecords();
  for (const record of map.values()) {
    if (constantTimeEqualString(record.key_hash, targetHash)) {
      return record;
    }
  }
  return null;
}

export async function findActiveApiKeyByReference(refs: {
  invoiceId?: string | null;
  subscriptionId?: string | null;
}): Promise<ApiKeyRecord | null> {
  const map = await readAllApiKeyRecords();
  for (const record of map.values()) {
    if (record.status !== "active") continue;
    if (refs.invoiceId && record.invoice_id === refs.invoiceId) return record;
    if (refs.subscriptionId && record.stripe_subscription_id === refs.subscriptionId) {
      return record;
    }
  }
  return null;
}

export async function revokeApiKey(id: string): Promise<PublicApiKeyRecord | null> {
  const map = await readAllApiKeyRecords();
  const existing = map.get(id);
  if (!existing) return null;
  if (existing.status === "revoked") return toPublicApiKeyRecord(existing);
  const updated: ApiKeyRecord = {
    ...existing,
    status: "revoked",
    revoked_at: new Date().toISOString(),
  };
  await appendApiKeyRecord(updated);
  return toPublicApiKeyRecord(updated);
}

export async function revokeApiKeysBySubscription(
  subscriptionId: string,
  customerId?: string | null,
): Promise<number> {
  const map = await readAllApiKeyRecords();
  let revokedCount = 0;
  for (const record of map.values()) {
    if (record.status !== "active") continue;
    const matchesSub = Boolean(subscriptionId && record.stripe_subscription_id === subscriptionId);
    const matchesCust = Boolean(
      !subscriptionId && customerId && record.stripe_customer_id === customerId,
    );
    if (matchesSub || matchesCust) {
      await appendApiKeyRecord({
        ...record,
        status: "revoked",
        revoked_at: new Date().toISOString(),
      });
      revokedCount += 1;
    }
  }
  return revokedCount;
}

export function extractPresentedApiKey(req: Request): string | null {
  const xApiKey = req.headers.get("x-api-key")?.trim();
  if (xApiKey) return xApiKey;
  const auth = req.headers.get("authorization")?.trim();
  if (auth) {
    const match = /^Bearer\s+(kvnc_(?:live|test)_[a-zA-Z0-9_-]+)$/i.exec(auth);
    if (match?.[1]) return match[1];
  }
  return null;
}

function resolvePublicRpm(): number {
  const raw = process.env.API_PUBLIC_RPM?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return DEFAULT_PUBLIC_RPM;
}

export function resetApiRateLimitForTests(): void {
  rateBuckets.clear();
}

/**
 * Enforce per-tier RPM rate limiting for metered RPC/API routes.
 * - Valid API key -> tier's configured RPM limit
 * - Explicitly supplied invalid/revoked API key -> HTTP 401
 * - Unauthenticated request -> graceful public fallback tier
 */
export async function checkApiRateLimit(
  req: Request,
  clientIp: string,
  now = Date.now(),
): Promise<RateLimitResult> {
  const presented = extractPresentedApiKey(req);
  let bucketKey: string;
  let limit: number;
  let tier: ApiKeyTier | "public";
  let keyId: string | null = null;

  if (presented) {
    const record = await lookupApiKeyByPlaintext(presented);
    if (!record || record.status !== "active") {
      return {
        allowed: false,
        status: 401,
        body: { ok: false, error: "Invalid or revoked API key." },
        headers: {
          "x-ratelimit-limit": "0",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.ceil((now + RATE_WINDOW_MS) / 1000)),
        },
        tier: "public",
        keyId: null,
      };
    }
    bucketKey = `key:${record.id}`;
    limit = record.rpm_limit;
    tier = record.tier;
    keyId = record.id;
  } else {
    bucketKey = `ip:${clientIp || "anonymous"}`;
    limit = resolvePublicRpm();
    tier = "public";
  }

  const prev = rateBuckets.get(bucketKey) ?? [];
  const fresh = prev.filter((ts) => now - ts < RATE_WINDOW_MS);
  const oldest = fresh[0] ?? now;
  const resetEpochSec = Math.ceil((oldest + RATE_WINDOW_MS) / 1000);

  if (fresh.length >= limit) {
    rateBuckets.set(bucketKey, fresh);
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000));
    return {
      allowed: false,
      status: 429,
      body: {
        ok: false,
        error: "Rate limit exceeded.",
        tier,
        limit,
        reset: resetEpochSec,
      },
      headers: {
        "x-ratelimit-limit": String(limit),
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(resetEpochSec),
        "x-ratelimit-tier": tier,
        "retry-after": String(retryAfterSec),
      },
      tier,
      keyId,
    };
  }

  fresh.push(now);
  rateBuckets.set(bucketKey, fresh);
  const remaining = Math.max(0, limit - fresh.length);

  return {
    allowed: true,
    headers: {
      "x-ratelimit-limit": String(limit),
      "x-ratelimit-remaining": String(remaining),
      "x-ratelimit-reset": String(resetEpochSec),
      "x-ratelimit-tier": tier,
    },
    tier,
    keyId,
  };
}

/**
 * Admin endpoints:
 * - POST /api/keys
 * - GET /api/keys
 * - DELETE /api/keys/:id
 */
export async function handleApiKeysRequest(
  req: Request,
  pathname: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const auth = verifyBillingAdminAuth(req);
  if (!auth.ok) {
    return { status: auth.status, body: { ok: false, error: auth.error } };
  }

  const method = req.method.toUpperCase();
  const suffix = pathname.replace(/^\/api\/keys\/?/, "").replace(/\/$/, "");

  if (method === "GET" && suffix === "") {
    const keys = await listApiKeys();
    return { status: 200, body: { ok: true, keys } };
  }

  if (method === "POST" && suffix === "") {
    let payload: Record<string, unknown>;
    try {
      payload = (await req.json()) as Record<string, unknown>;
    } catch {
      return { status: 400, body: { ok: false, error: "Invalid JSON body." } };
    }

    const rawTier = typeof payload.tier === "string" ? payload.tier.trim() : "";
    if (!VALID_API_KEY_TIERS.has(rawTier as ApiKeyTier)) {
      return {
        status: 400,
        body: {
          ok: false,
          error:
            "Invalid tier. Expected free, builder, growth, enterprise, rwa-starter, or rwa-enterprise.",
        },
      };
    }

    const mode = payload.mode === "test" ? "test" : "live";
    const { key, publicRecord } = await createApiKey({
      tier: rawTier as ApiKeyTier,
      mode,
      label: typeof payload.label === "string" ? payload.label : null,
      owner_email: typeof payload.owner_email === "string" ? payload.owner_email : null,
      invoice_id: typeof payload.invoice_id === "string" ? payload.invoice_id : null,
    });

    return {
      status: 201,
      body: {
        ok: true,
        api_key: key,
        key: publicRecord,
        warning: "Store this API key securely — the plaintext value is shown only once.",
      },
    };
  }

  if (method === "DELETE" && suffix.length > 0 && !suffix.includes("/")) {
    const revoked = await revokeApiKey(suffix);
    if (!revoked) {
      return { status: 404, body: { ok: false, error: "API key not found." } };
    }
    return { status: 200, body: { ok: true, key: revoked } };
  }

  return { status: 405, body: { ok: false, error: "Method or path not allowed." } };
}
