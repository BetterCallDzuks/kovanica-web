import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RWA_REGISTRY,
  chunkAllowlistEntries,
  computeProRataCouponDistribution,
  formatRwaSupply,
  isPro21AddressFormat,
  validateMintAgainstCap,
} from "../src/lib/rwa/compliance";

describe("RWA (KVP-106) Institutional Compliance & Dividend Helpers", () => {
  it("validates PRO-21 address formats strictly", () => {
    assert.equal(
      isPro21AddressFormat("kvnc11111111111111111111111111111111111111111111111111111111dag"),
      true,
    );
    assert.equal(isPro21AddressFormat("0x1234567890abcdef"), false);
    assert.equal(isPro21AddressFormat("not-valid"), false);
  });

  it("chunks allowlist updates into Wave A batches of <= 16 entries", () => {
    const items = Array.from({ length: 35 }, (_, i) => `addr-${i}`);
    const chunks = chunkAllowlistEntries(items);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0]?.length, 16);
    assert.equal(chunks[1]?.length, 16);
    assert.equal(chunks[2]?.length, 3);
  });

  it("enforces mint supply caps and permits uncapped (0) assets", () => {
    assert.deepEqual(validateMintAgainstCap(900n, 1000n, 100n), { ok: true, nextSupply: 1000n });
    const over = validateMintAgainstCap(900n, 1000n, 101n);
    assert.equal(over.ok, false);
    assert.deepEqual(validateMintAgainstCap(5000n, 0n, 999999n), {
      ok: true,
      nextSupply: 1004999n,
    });
  });

  it("computes pro-rata coupon distribution excluding frozen and non-allowlisted holders", () => {
    const res = computeProRataCouponDistribution(1_000_000_000n, [
      { address: "a", balance: 750n, allowlisted: true, kycTier: 2, frozen: false },
      { address: "b", balance: 250n, allowlisted: true, kycTier: 1, frozen: false },
      { address: "c", balance: 500n, allowlisted: true, kycTier: 1, frozen: true },
      { address: "d", balance: 500n, allowlisted: false, kycTier: 0, frozen: false },
    ]);
    assert.equal(res.eligibleHolders.length, 2);
    assert.equal(res.eligibleHolders[0]?.payoutAtoms, 750_000_000n);
    assert.equal(res.eligibleHolders[1]?.payoutAtoms, 250_000_000n);
    assert.equal(res.dustRemainder, 0n);
  });

  it("exposes default institutional registry entries and formats supply", () => {
    assert.ok(DEFAULT_RWA_REGISTRY.length >= 4);
    assert.equal(formatRwaSupply("12500000000000", 6), "12,500,000");
  });
});
