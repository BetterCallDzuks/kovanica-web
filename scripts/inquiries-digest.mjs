#!/usr/bin/env node
/**
 * Admin digest CLI for Kovanica `/api/inquiries` JSONL intake (`data/inquiries.jsonl`).
 *
 * Usage:
 *   node scripts/inquiries-digest.mjs [options]
 *
 * Options:
 *   --file <path>            Path to inquiries JSONL (default: INQUIRIES_FILE || KOVANICA_INQUIRIES_FILE || data/inquiries.jsonl)
 *   --since <ISO|7d|24h|30m> Only include inquiries created at or after this cutoff
 *   --format <markdown|json> Output format (default: markdown)
 *   --redact-pii             Mask names, emails, and embedded emails (default: enabled)
 *   --no-redact-pii, --full  Include full unredacted contact info (admin terminal only)
 *   --followup-hours <num>   Flag inquiries older than N hours as SLA follow-up (default: 24)
 *   --help, -h               Show usage help
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KNOWN_TOPICS = ["rpc", "rwa", "listing", "sponsorship", "enterprise", "pool"];
const HIGH_PRIORITY_TOPICS = new Set(["enterprise", "rwa"]);
const HIGH_PRIORITY_PLAN_RE = /\b(enterprise|institutional|dedicated|custom)\b/i;
const EMBEDDED_EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const DURATION_RE = /^(\d+)([mhdw])$/i;

const DURATION_MS = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

export function resolveDefaultFilePath(env = process.env, cwd = process.cwd()) {
  const fromEnv = env.INQUIRIES_FILE?.trim() || env.KOVANICA_INQUIRIES_FILE?.trim();
  return resolve(cwd, fromEnv || "data/inquiries.jsonl");
}

export function parseSince(spec, nowMs = Date.now()) {
  if (!spec) return null;
  const trimmed = String(spec).trim();
  if (!trimmed) return null;

  const relMatch = DURATION_RE.exec(trimmed);
  if (relMatch) {
    const amount = Number(relMatch[1]);
    const unit = relMatch[2].toLowerCase();
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Invalid --since duration: "${spec}"`);
    }
    return new Date(nowMs - amount * DURATION_MS[unit]);
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `Invalid --since value "${spec}". Use an ISO-8601 timestamp or relative duration like 24h, 7d, 30m, 2w.`,
    );
  }
  return new Date(parsed);
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const opts = {
    file: resolveDefaultFilePath(env, cwd),
    since: null,
    format: "markdown",
    redactPii: true,
    followupHours: 24,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--file") {
      const val = argv[++i];
      if (!val) throw new Error("--file requires a path argument");
      opts.file = resolve(cwd, val);
    } else if (arg.startsWith("--file=")) {
      const val = arg.slice("--file=".length);
      if (!val) throw new Error("--file requires a path argument");
      opts.file = resolve(cwd, val);
    } else if (arg === "--since") {
      const val = argv[++i];
      if (!val) throw new Error("--since requires a value (e.g. 24h, 7d, 2026-11-01T00:00:00Z)");
      opts.since = val;
    } else if (arg.startsWith("--since=")) {
      opts.since = arg.slice("--since=".length);
    } else if (arg === "--format") {
      const val = argv[++i];
      if (!val) throw new Error("--format requires 'markdown' or 'json'");
      opts.format = val.toLowerCase();
    } else if (arg.startsWith("--format=")) {
      opts.format = arg.slice("--format=".length).toLowerCase();
    } else if (arg === "--redact-pii") {
      opts.redactPii = true;
    } else if (arg === "--no-redact-pii" || arg === "--full") {
      opts.redactPii = false;
    } else if (arg === "--followup-hours") {
      const val = Number(argv[++i]);
      if (!Number.isFinite(val) || val < 0) {
        throw new Error("--followup-hours requires a non-negative number");
      }
      opts.followupHours = val;
    } else if (arg.startsWith("--followup-hours=")) {
      const val = Number(arg.slice("--followup-hours=".length));
      if (!Number.isFinite(val) || val < 0) {
        throw new Error("--followup-hours requires a non-negative number");
      }
      opts.followupHours = val;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (opts.format !== "markdown" && opts.format !== "json") {
    throw new Error(`Invalid --format "${opts.format}". Expected "markdown" or "json".`);
  }

  return opts;
}

export function redactEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return "[redacted]";
  const atIdx = email.indexOf("@");
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  const prefix = local.length > 0 ? local[0] : "*";
  return `${prefix}***@${domain}`;
}

export function redactName(name) {
  if (typeof name !== "string" || !name.trim()) return "[redacted]";
  return name
    .trim()
    .split(/\s+/)
    .map((part) => (part.length > 0 ? `${part[0]}***` : "***"))
    .join(" ");
}

export function redactDetails(details, maxLen = 140) {
  if (typeof details !== "string") return "";
  const scrubbed = details.replace(EMBEDDED_EMAIL_RE, (m) => redactEmail(m)).replace(/\s+/g, " ").trim();
  if (scrubbed.length <= maxLen) return scrubbed;
  return `${scrubbed.slice(0, maxLen - 1)}…`;
}

export function parseInquiriesJsonl(rawText) {
  const records = [];
  const malformed = [];
  const lines = rawText.split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx].trim();
    if (!line) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      malformed.push({
        line: idx + 1,
        reason: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      malformed.push({ line: idx + 1, reason: "Expected a JSON object" });
      continue;
    }

    const createdMs = typeof parsed.created_at === "string" ? Date.parse(parsed.created_at) : Number.NaN;
    if (typeof parsed.id !== "string" || !parsed.id.trim() || Number.isNaN(createdMs)) {
      malformed.push({ line: idx + 1, reason: "Missing valid id or ISO created_at" });
      continue;
    }

    const topic = typeof parsed.topic === "string" && parsed.topic.trim() ? parsed.topic.trim().toLowerCase() : "unknown";
    records.push({
      id: parsed.id.trim(),
      created_at: new Date(createdMs).toISOString(),
      createdMs,
      topic,
      plan: typeof parsed.plan === "string" && parsed.plan.trim() ? parsed.plan.trim() : null,
      name: typeof parsed.name === "string" ? parsed.name.trim() : "",
      email: typeof parsed.email === "string" ? parsed.email.trim() : "",
      organization:
        typeof parsed.organization === "string" && parsed.organization.trim() ? parsed.organization.trim() : null,
      details: typeof parsed.details === "string" ? parsed.details.trim() : "",
    });
  }

  return { records, malformed };
}

function evaluateFollowUp(rec, nowMs, followupHours) {
  const ageHours = Math.max(0, (nowMs - rec.createdMs) / (60 * 60 * 1000));
  const reasons = [];

  if (HIGH_PRIORITY_TOPICS.has(rec.topic)) {
    reasons.push(`high-priority topic (${rec.topic})`);
  }
  if (rec.plan && HIGH_PRIORITY_PLAN_RE.test(rec.plan)) {
    reasons.push(`tier requires review (${rec.plan})`);
  }
  if (ageHours >= followupHours) {
    reasons.push(`age ${Math.floor(ageHours)}h >= ${followupHours}h SLA`);
  }

  return {
    needsFollowUp: reasons.length > 0,
    priority: HIGH_PRIORITY_TOPICS.has(rec.topic) || (rec.plan && HIGH_PRIORITY_PLAN_RE.test(rec.plan)) ? "high" : "normal",
    ageHours: Number(ageHours.toFixed(1)),
    reasons,
  };
}

export function buildInquiryDigest(rawText, options = {}) {
  const nowMs = options.now instanceof Date ? options.now.getTime() : typeof options.now === "number" ? options.now : Date.now();
  const sinceDate = options.since ? parseSince(options.since, nowMs) : null;
  const redactPii = options.redactPii !== undefined ? Boolean(options.redactPii) : true;
  const followupHours = typeof options.followupHours === "number" ? options.followupHours : 24;
  const fileExists = options.fileExists !== undefined ? Boolean(options.fileExists) : true;

  const { records, malformed } = fileExists ? parseInquiriesJsonl(rawText || "") : { records: [], malformed: [] };
  const filtered = sinceDate ? records.filter((r) => r.createdMs >= sinceDate.getTime()) : records;
  filtered.sort((a, b) => b.createdMs - a.createdMs);

  const byTopic = {};
  const byPlan = {};
  const followUps = [];
  const items = [];

  for (const rec of filtered) {
    byTopic[rec.topic] = (byTopic[rec.topic] || 0) + 1;
    const planKey = rec.plan || "(unspecified)";
    byPlan[planKey] = (byPlan[planKey] || 0) + 1;

    const followUp = evaluateFollowUp(rec, nowMs, followupHours);
    const entry = {
      id: rec.id,
      created_at: rec.created_at,
      topic: rec.topic,
      plan: rec.plan,
      name: redactPii ? redactName(rec.name) : rec.name,
      email: redactPii ? redactEmail(rec.email) : rec.email,
      organization: rec.organization,
      details: redactPii ? redactDetails(rec.details) : rec.details,
      priority: followUp.priority,
      age_hours: followUp.ageHours,
      follow_up_reasons: followUp.reasons,
    };

    items.push(entry);
    if (followUp.needsFollowUp) {
      followUps.push(entry);
    }
  }

  // Deterministic key order for topic counts (known topics first, then extras)
  const orderedByTopic = {};
  for (const t of KNOWN_TOPICS) {
    if (byTopic[t]) orderedByTopic[t] = byTopic[t];
  }
  for (const [k, v] of Object.entries(byTopic).sort(([a], [b]) => a.localeCompare(b))) {
    if (!(k in orderedByTopic)) orderedByTopic[k] = v;
  }

  const orderedByPlan = Object.fromEntries(
    Object.entries(byPlan).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );

  return {
    generated_at: new Date(nowMs).toISOString(),
    file: options.file || "data/inquiries.jsonl",
    file_exists: fileExists,
    since: sinceDate ? sinceDate.toISOString() : null,
    redact_pii: redactPii,
    followup_hours: followupHours,
    totals: {
      parsed: records.length,
      in_window: filtered.length,
      malformed_lines: malformed.length,
      follow_ups: followUps.length,
    },
    by_topic: orderedByTopic,
    by_plan: orderedByPlan,
    malformed,
    follow_ups: followUps,
    inquiries: items,
  };
}

export function formatDigestMarkdown(digest) {
  const lines = [];
  lines.push("# Kovanica Inquiry Admin Digest");
  lines.push("");
  lines.push(`- **Generated:** \`${digest.generated_at}\``);
  lines.push(`- **Source:** \`${digest.file}\`${digest.file_exists ? "" : " *(file not found yet — 0 inquiries)*"}`);
  lines.push(`- **Window:** ${digest.since ? `since \`${digest.since}\`` : "all time"}`);
  lines.push(`- **PII Mode:** ${digest.redact_pii ? "redacted (safe summary)" : "full (unredacted admin)"}`);
  lines.push(
    `- **Totals:** ${digest.totals.in_window} in window (${digest.totals.parsed} total valid, ${digest.totals.malformed_lines} malformed skipped, ${digest.totals.follow_ups} flagged for follow-up)`,
  );
  lines.push("");

  if (digest.totals.in_window === 0) {
    lines.push("_No inquiries recorded in the selected window._");
  } else {
    lines.push("## Breakdown by Category (`topic`)");
    lines.push("");
    lines.push("| Category | Count |");
    lines.push("|---|---:|");
    for (const [topic, count] of Object.entries(digest.by_topic)) {
      lines.push(`| \`${topic}\` | ${count} |`);
    }
    lines.push("");

    lines.push("## Breakdown by Tier / Plan");
    lines.push("");
    lines.push("| Tier / Plan | Count |");
    lines.push("|---|---:|");
    for (const [plan, count] of Object.entries(digest.by_plan)) {
      lines.push(`| ${plan} | ${count} |`);
    }
    lines.push("");

    if (digest.follow_ups.length > 0) {
      lines.push(`## Flagged Follow-Ups (${digest.follow_ups.length})`);
      lines.push("");
      for (const item of digest.follow_ups) {
        const org = item.organization ? ` · ${item.organization}` : "";
        const plan = item.plan ? ` · ${item.plan}` : "";
        lines.push(
          `- **[${item.priority.toUpperCase()}]** \`${item.id}\` (\`${item.topic}\`${plan}) — ${item.name} <${item.email}>${org} · _${item.follow_up_reasons.join("; ")}_`,
        );
      }
      lines.push("");
    }

    lines.push("## Recent Inquiries");
    lines.push("");
    lines.push("| Date (UTC) | ID | Category | Plan | Contact | Organization | Summary |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const item of digest.inquiries) {
      const dateStr = item.created_at.slice(0, 16).replace("T", " ");
      const contact = `${item.name} <${item.email}>`.replace(/\|/g, "\\|");
      const org = (item.organization || "—").replace(/\|/g, "\\|");
      const plan = (item.plan || "—").replace(/\|/g, "\\|");
      const summary = item.details.replace(/\|/g, "\\|");
      lines.push(`| \`${dateStr}\` | \`${item.id}\` | \`${item.topic}\` | ${plan} | ${contact} | ${org} | ${summary} |`);
    }
  }

  if (digest.malformed.length > 0) {
    lines.push("");
    lines.push(`## Malformed Lines Skipped (${digest.malformed.length})`);
    lines.push("");
    for (const m of digest.malformed) {
      lines.push(`- Line ${m.line}: ${m.reason}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

const HELP_TEXT = `Kovanica Inquiry Admin Digest CLI

Usage:
  node scripts/inquiries-digest.mjs [options]

Options:
  --file <path>            Path to JSONL file (default: INQUIRIES_FILE || KOVANICA_INQUIRIES_FILE || data/inquiries.jsonl)
  --since <ISO|7d|24h|30m> Filter records created at or after cutoff
  --format <markdown|json> Output format (default: markdown)
  --redact-pii             Mask names, emails, and embedded emails (default)
  --no-redact-pii, --full  Output full unredacted contact info (admin only)
  --followup-hours <num>   Flag inquiries >= N hours old for follow-up (default: 24)
  --help, -h               Show this help text
`;

export function runCli(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), now = new Date()) {
  const opts = parseArgs(argv, env, cwd);
  if (opts.help) {
    return { exitCode: 0, output: HELP_TEXT };
  }

  const fileExists = existsSync(opts.file);
  const rawText = fileExists ? readFileSync(opts.file, "utf8") : "";
  const digest = buildInquiryDigest(rawText, {
    file: opts.file,
    fileExists,
    since: opts.since,
    redactPii: opts.redactPii,
    followupHours: opts.followupHours,
    now,
  });

  const output = opts.format === "json" ? `${JSON.stringify(digest, null, 2)}\n` : formatDigestMarkdown(digest);
  return { exitCode: 0, output, digest };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const res = runCli();
    process.stdout.write(res.output);
    process.exit(res.exitCode);
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
