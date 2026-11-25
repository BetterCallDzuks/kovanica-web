import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildInquiryDigest,
  formatDigestMarkdown,
  parseArgs,
  parseInquiriesJsonl,
  parseSince,
  redactEmail,
  redactName,
  runCli,
} from "./inquiries-digest.mjs";

const NOW = new Date("2026-11-25T20:00:00.000Z");

const SAMPLE_JSONL = [
  JSON.stringify({
    id: "inq_aaa111222333",
    created_at: "2026-11-25T18:00:00.000Z", // 2h ago
    topic: "rpc",
    plan: "Builder ($79/mo)",
    name: "Elena Markovic",
    email: "elena@walletco.io",
    organization: "WalletCo",
    details: "Need 100 RPS mainnet RPC key; reach me at ops@walletco.io if urgent.",
  }),
  "not valid json {{{",
  "",
  JSON.stringify({ id: "missing-created-at", topic: "rpc" }),
  JSON.stringify({
    id: "inq_bbb444555666",
    created_at: "2026-11-24T10:00:00.000Z", // 34h ago (> 24h SLA)
    topic: "rwa",
    plan: "Institutional Compliance ($999)",
    name: "Alex Novak",
    email: "alex@novakcap.com",
    organization: "Novak Capital",
    details: "Issuing KVP-106 corporate bond with quarterly coupon schedule.",
  }),
  JSON.stringify({
    id: "inq_ccc777888999",
    created_at: "2026-11-10T09:00:00.000Z", // 15d ago
    topic: "enterprise",
    plan: "Enterprise Integration",
    name: "Sam Chen",
    email: "sam@custody.example",
    organization: "Custody Labs",
    details: "Custom hardware custody integration for Mainnet launch.",
  }),
].join("\n");

test("parseInquiriesJsonl parses valid lines and skips malformed/incomplete records cleanly", () => {
  const { records, malformed } = parseInquiriesJsonl(SAMPLE_JSONL);
  assert.equal(records.length, 3);
  assert.equal(malformed.length, 2);
  assert.equal(malformed[0].line, 2);
  assert.match(malformed[0].reason, /JSON parse error/);
  assert.equal(malformed[1].line, 4);
  assert.match(malformed[1].reason, /Missing valid id or ISO created_at/);
});

test("parseSince supports relative durations (24h, 7d, 30m) and ISO timestamps", () => {
  const cutoff24h = parseSince("24h", NOW.getTime());
  assert.equal(cutoff24h.toISOString(), "2026-11-24T20:00:00.000Z");

  const cutoff7d = parseSince("7d", NOW.getTime());
  assert.equal(cutoff7d.toISOString(), "2026-11-18T20:00:00.000Z");

  const cutoffIso = parseSince("2026-11-20T00:00:00Z", NOW.getTime());
  assert.equal(cutoffIso.toISOString(), "2026-11-20T00:00:00.000Z");

  assert.throws(() => parseSince("not-a-date", NOW.getTime()), /Invalid --since/);
});

test("buildInquiryDigest filters by --since, groups by topic/plan, flags follow-ups, and redacts PII by default", () => {
  const digest = buildInquiryDigest(SAMPLE_JSONL, {
    now: NOW,
    since: "7d",
    redactPii: true,
    followupHours: 24,
  });

  assert.equal(digest.totals.parsed, 3);
  assert.equal(digest.totals.in_window, 2);
  assert.equal(digest.totals.malformed_lines, 2);
  assert.equal(digest.totals.follow_ups, 1);

  assert.deepEqual(digest.by_topic, { rpc: 1, rwa: 1 });
  assert.deepEqual(digest.by_plan, {
    "Builder ($79/mo)": 1,
    "Institutional Compliance ($999)": 1,
  });

  // Verify PII redaction
  const rpcEntry = digest.inquiries.find((i) => i.id === "inq_aaa111222333");
  assert.equal(rpcEntry.name, "E*** M***");
  assert.equal(rpcEntry.email, "e***@walletco.io");
  assert.ok(!rpcEntry.details.includes("ops@walletco.io"), "Embedded email in details must be redacted");
  assert.ok(rpcEntry.details.includes("o***@walletco.io"));

  // Verify follow-up flagging on RWA institutional inquiry (both high-priority topic and >24h SLA)
  const rwaFollowUp = digest.follow_ups[0];
  assert.equal(rwaFollowUp.id, "inq_bbb444555666");
  assert.equal(rwaFollowUp.priority, "high");
  assert.ok(rwaFollowUp.follow_up_reasons.some((r) => r.includes("high-priority topic")));
  assert.ok(rwaFollowUp.follow_up_reasons.some((r) => r.includes("SLA")));
});

test("full admin mode (--no-redact-pii) preserves unredacted contact info and markdown renders cleanly", () => {
  const digest = buildInquiryDigest(SAMPLE_JSONL, {
    now: NOW,
    since: "24h",
    redactPii: false,
  });

  assert.equal(digest.totals.in_window, 1);
  assert.equal(digest.inquiries[0].name, "Elena Markovic");
  assert.equal(digest.inquiries[0].email, "elena@walletco.io");

  const md = formatDigestMarkdown(digest);
  assert.match(md, /# Kovanica Inquiry Admin Digest/);
  assert.match(md, /Elena Markovic <elena@walletco\.io>/);
  assert.match(md, /Malformed Lines Skipped \(2\)/);
});

test("redactEmail and redactName handle edge cases safely", () => {
  assert.equal(redactEmail("alice@kovanica.online"), "a***@kovanica.online");
  assert.equal(redactEmail("not-an-email"), "[redacted]");
  assert.equal(redactName("Alice Bob"), "A*** B***");
  assert.equal(redactName(""), "[redacted]");
});

test("runCli reads --file, supports JSON format, and handles missing files gracefully", () => {
  const dir = mkdtempSync(join(tmpdir(), "kovanica-digest-"));
  const filePath = join(dir, "inquiries.jsonl");
  try {
    writeFileSync(filePath, SAMPLE_JSONL, "utf8");

    const jsonRes = runCli(["--file", filePath, "--since", "7d", "--format", "json", "--redact-pii"], {}, dir, NOW);
    assert.equal(jsonRes.exitCode, 0);
    const parsed = JSON.parse(jsonRes.output);
    assert.equal(parsed.totals.in_window, 2);
    assert.equal(parsed.redact_pii, true);

    const missingPath = join(dir, "does-not-exist.jsonl");
    const emptyRes = runCli(["--file", missingPath, "--format", "markdown"], {}, dir, NOW);
    assert.equal(emptyRes.exitCode, 0);
    assert.match(emptyRes.output, /file not found yet/);
    assert.equal(emptyRes.digest.totals.in_window, 0);

    const envOpts = parseArgs([], { INQUIRIES_FILE: filePath }, dir);
    assert.equal(envOpts.file, filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
