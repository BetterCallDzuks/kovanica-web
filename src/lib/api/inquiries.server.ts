import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { InquiryTopic } from "@/lib/monetization";

const ALLOWED_TOPICS = new Set<InquiryTopic>([
  "rpc",
  "rwa",
  "listing",
  "sponsorship",
  "enterprise",
  "pool",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_REQUESTS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;
const ipHits = new Map<string, number[]>();

export interface InquiryRecord {
  id: string;
  created_at: string;
  topic: InquiryTopic;
  plan: string | null;
  name: string;
  email: string;
  organization: string | null;
  details: string;
}

function checkRateLimit(clientKey: string, now = Date.now()): boolean {
  const prev = ipHits.get(clientKey) ?? [];
  const fresh = prev.filter((ts) => now - ts < WINDOW_MS);
  if (fresh.length >= MAX_REQUESTS_PER_WINDOW) {
    ipHits.set(clientKey, fresh);
    return false;
  }
  fresh.push(now);
  ipHits.set(clientKey, fresh);
  return true;
}

export function resetInquiryRateLimitForTests(): void {
  ipHits.clear();
}

export function resolveInquiriesFilePath(): string {
  const envPath = process.env.KOVANICA_INQUIRIES_FILE?.trim();
  if (envPath) return resolve(envPath);
  return resolve(process.cwd(), "data/inquiries.jsonl");
}

function cleanStr(val: unknown, maxLen: number): string {
  if (typeof val !== "string") return "";
  let out = "";
  for (let i = 0; i < val.length; i += 1) {
    const code = val.charCodeAt(i);
    if (code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      out += val[i];
    }
  }
  return out.trim().slice(0, maxLen);
}

export async function handleInquirySubmission(
  req: Request,
  clientKey: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!checkRateLimit(clientKey)) {
    return {
      status: 429,
      body: { ok: false, error: "Too many inquiry requests. Please wait a few minutes and try again." },
    };
  }

  let payload: Record<string, unknown>;
  try {
    const rawText = await req.text();
    if (rawText.length > 16_384) {
      return { status: 413, body: { ok: false, error: "Request body too large." } };
    }
    payload = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { ok: false, error: "Invalid JSON body." } };
  }

  // Silent honeypot for automated bots
  if (typeof payload.website === "string" && payload.website.trim().length > 0) {
    return { status: 202, body: { ok: true, reference_id: "accepted" } };
  }

  const rawTopic = cleanStr(payload.topic, 32) as InquiryTopic;
  if (!ALLOWED_TOPICS.has(rawTopic)) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "Invalid topic. Expected rpc, rwa, listing, sponsorship, enterprise, or pool.",
      },
    };
  }

  const name = cleanStr(payload.name, 120);
  if (name.length < 2) {
    return { status: 400, body: { ok: false, error: "Please enter your name (at least 2 characters)." } };
  }

  const email = cleanStr(payload.email, 200);
  if (!EMAIL_RE.test(email)) {
    return { status: 400, body: { ok: false, error: "Please enter a valid contact email." } };
  }

  const organization = cleanStr(payload.organization, 160) || null;
  const plan = cleanStr(payload.plan, 120) || null;
  const details = cleanStr(payload.details, 2000);
  if (details.length < 10) {
    return {
      status: 400,
      body: { ok: false, error: "Please include at least 10 characters describing your use case." },
    };
  }

  const record: InquiryRecord = {
    id: `inq_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    created_at: new Date().toISOString(),
    topic: rawTopic,
    plan,
    name,
    email,
    organization,
    details,
  };

  try {
    const filePath = resolveInquiriesFilePath();
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    return {
      status: 500,
      body: { ok: false, error: "Unable to record inquiry right now. Please try again later." },
    };
  }

  return {
    status: 201,
    body: {
      ok: true,
      reference_id: record.id,
      topic: record.topic,
      created_at: record.created_at,
    },
  };
}
