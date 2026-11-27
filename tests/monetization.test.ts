import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RPC_TIERS,
  RWA_PLANS,
  LISTING_AND_SPONSOR_OFFERS,
  ENTERPRISE_OFFERS,
  computeSwapInterfaceFee,
  getMiningPoolFeeConfig,
  getPartnerLinks,
  getSponsorConfig,
  getSwapInterfaceFeeConfig,
  sanitizeHttpsUrl,
} from "../src/lib/monetization";
import {
  handleInquirySubmission,
  resetInquiryRateLimitForTests,
} from "../src/lib/api/inquiries.server";

test("monetization config covers all 6 revenue streams and defaults safely on testnet", () => {
  assert.ok(RPC_TIERS.length >= 4, "Expected at least 4 RPC tiers");
  assert.ok(RWA_PLANS.length >= 3, "Expected at least 3 RWA SaaS plans");
  assert.ok(LISTING_AND_SPONSOR_OFFERS.length >= 3, "Expected verified listing & sponsorship offers");
  assert.ok(ENTERPRISE_OFFERS.length >= 3, "Expected enterprise integration offers");

  const swapDefault = getSwapInterfaceFeeConfig({ feeBps: "" });
  assert.equal(swapDefault.feeBps, 0);
  assert.equal(swapDefault.active, false);

  const swapCustom = getSwapInterfaceFeeConfig({ feeBps: "20" });
  assert.equal(swapCustom.feeBps, 20);
  assert.equal(swapCustom.active, true);

  const swapClamped = getSwapInterfaceFeeConfig({ feeBps: "9999" });
  assert.equal(swapClamped.feeBps, 100, "Swap interface fee must be capped at 100 bps (1.00%)");

  assert.equal(computeSwapInterfaceFee(1_000_000_000n, 0), 0n);
  assert.equal(computeSwapInterfaceFee(1_000_000_000n, 20), 2_000_000n);
  assert.equal(computeSwapInterfaceFee(0n, 20), 0n);

  const poolFee = getMiningPoolFeeConfig({ plannedMainnetFeePct: "1.0" });
  assert.equal(poolFee.testnetFeePct, 0);
  assert.equal(poolFee.plannedMainnetFeePct, 1.0);
});

test("sponsor and partner configs reject unsafe URLs and stay off until configured", () => {
  assert.equal(sanitizeHttpsUrl("javascript:alert(1)"), null);
  assert.equal(sanitizeHttpsUrl("http://insecure.example.com"), null);
  assert.equal(sanitizeHttpsUrl("https://partner.example.com/ref"), "https://partner.example.com/ref");

  assert.equal(getSponsorConfig({ url: "", text: "" }), null);
  assert.equal(getSponsorConfig({ url: "http://bad.example.com", text: "Hi" }), null);

  const validSponsor = getSponsorConfig({
    label: "Partner",
    text: "Secure hardware custody",
    url: "https://hardware.example.com",
    cta: "Explore",
  });
  assert.deepEqual(validSponsor, {
    label: "Partner",
    text: "Secure hardware custody",
    url: "https://hardware.example.com/",
    cta: "Explore",
  });

  assert.equal(getPartnerLinks({ hardwareUrl: "", vpsUrl: "" }).length, 0);
  const partners = getPartnerLinks({
    hardwareUrl: "https://hw.example.com/kovanica",
    vpsUrl: "https://vps.example.com/kovanica",
  });
  assert.equal(partners.length, 2);
});

test("POST /api/inquiries validates input, traps honeypot bots, and persists valid leads to JSONL", async () => {
  resetInquiryRateLimitForTests();
  const dir = mkdtempSync(join(tmpdir(), "kovanica-inquiries-"));
  const outFile = join(dir, "inquiries.jsonl");
  const prevEnv = process.env.KOVANICA_INQUIRIES_FILE;
  process.env.KOVANICA_INQUIRIES_FILE = outFile;

  try {
    // Invalid email -> 400
    const badRes = await handleInquirySubmission(
      new Request("http://localhost/api/inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: "rpc",
          name: "Alex",
          email: "not-an-email",
          details: "Need 100 RPS API key for wallet backend.",
        }),
      }),
      "127.0.0.1",
    );
    assert.equal(badRes.status, 400);

    // Honeypot filled -> 202 without writing
    const botRes = await handleInquirySubmission(
      new Request("http://localhost/api/inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: "rpc",
          name: "Bot",
          email: "bot@example.com",
          details: "Spam payload from automated crawler.",
          website: "https://spam.example.com",
        }),
      }),
      "127.0.0.1",
    );
    assert.equal(botRes.status, 202);

    // Valid inquiry -> 201 and persisted
    const okRes = await handleInquirySubmission(
      new Request("http://localhost/api/inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: "rwa",
          plan: "Institutional Compliance ($999)",
          name: "Alex Novak",
          email: "alex@example.com",
          organization: "Novak Capital",
          details: "Issuing KVP-106 corporate bond with quarterly coupon schedule.",
        }),
      }),
      "127.0.0.1",
    );
    assert.equal(okRes.status, 201);
    assert.equal(okRes.body.ok, true);
    assert.match(String(okRes.body.reference_id), /^inq_[a-f0-9]{12}$/);

    const lines = readFileSync(outFile, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const saved = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(saved.topic, "rwa");
    assert.equal(saved.email, "alex@example.com");
    assert.equal(saved.organization, "Novak Capital");
  } finally {
    if (prevEnv === undefined) {
      delete process.env.KOVANICA_INQUIRIES_FILE;
    } else {
      process.env.KOVANICA_INQUIRIES_FILE = prevEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("/support route wraps in unified <Shell> and /pricing is removed", () => {
  const supportSource = readFileSync(join(process.cwd(), "src/routes/support.tsx"), "utf8");
  assert.ok(supportSource.includes("<Shell>"), "support.tsx must render inside <Shell>");
  assert.throws(
    () => readFileSync(join(process.cwd(), "src/routes/pricing.tsx"), "utf8"),
    "pricing.tsx must be removed",
  );
});
