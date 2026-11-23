import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FEE_SAFETY_MULTIPLIER_BPS,
  classifyFeePressure,
  computeBufferedFeeAtoms,
} from "../src/lib/explorer/fee-pressure";

test("computeBufferedFeeAtoms applies exact ceiling BigInt math for 1.2x and custom multipliers", () => {
  assert.equal(DEFAULT_FEE_SAFETY_MULTIPLIER_BPS, 12_000);

  // Zero remains zero
  assert.equal(computeBufferedFeeAtoms(0n), 0n);
  assert.equal(computeBufferedFeeAtoms(10_000n, 0), 0n);

  // Exact multiples of 5 have no remainder at 12_000 bps (1.2x)
  assert.equal(computeBufferedFeeAtoms(5n), 6n);
  assert.equal(computeBufferedFeeAtoms(10n), 12n);
  assert.equal(computeBufferedFeeAtoms(5_000n), 6_000n);
  assert.equal(computeBufferedFeeAtoms(10_000n), 12_000n);

  // Non-multiples round up (ceiling)
  assert.equal(computeBufferedFeeAtoms(1n), 2n); // 1.2 -> 2
  assert.equal(computeBufferedFeeAtoms(2n), 3n); // 2.4 -> 3
  assert.equal(computeBufferedFeeAtoms(3n), 4n); // 3.6 -> 4
  assert.equal(computeBufferedFeeAtoms(4n), 5n); // 4.8 -> 5
  assert.equal(computeBufferedFeeAtoms(7n), 9n); // 8.4 -> 9

  // Custom multipliers (1.5x = 15_000 bps, 1.0001x = 10_001 bps)
  assert.equal(computeBufferedFeeAtoms(3n, 15_000), 5n); // 4.5 -> 5
  assert.equal(computeBufferedFeeAtoms(1n, 10_001), 2n); // 1.0001 -> 2

  // Large BigInt precision beyond Number.MAX_SAFE_INTEGER
  const large = 10_000_000_000_000_000_001n;
  assert.equal(computeBufferedFeeAtoms(large), 12_000_000_000_000_000_002n);
});

test("computeBufferedFeeAtoms rejects negative or invalid inputs", () => {
  assert.throws(() => computeBufferedFeeAtoms(-1n), RangeError);
  assert.throws(() => computeBufferedFeeAtoms(-10_000n), RangeError);
  assert.throws(() => computeBufferedFeeAtoms(100n, -1), RangeError);
  assert.throws(() => computeBufferedFeeAtoms(100n, Number.NaN), RangeError);
  assert.throws(() => computeBufferedFeeAtoms(100n, Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => computeBufferedFeeAtoms(100n, 12_000.5), RangeError);
});

test("classifyFeePressure covers all 5 tiers: low, normal, elevated, congested, unknown", () => {
  // 1. low
  const low = classifyFeePressure(5_000n, 0);
  assert.equal(low.tier, "low");
  assert.equal(low.label, "Low");
  assert.equal(low.baseFeeAtomsPerByte, 5_000n);
  assert.equal(low.bufferedFeeAtomsPerByte, 6_000n);
  assert.equal(low.pendingTxCount, 0);
  assert.equal(low.formattedBaseFee, "5,000 atoms/B");
  assert.equal(low.formattedBufferedFee, "6,000 atoms/B");

  // 2. normal
  const normal = classifyFeePressure(10_000n, 5);
  assert.equal(normal.tier, "normal");
  assert.equal(normal.label, "Normal");
  assert.equal(normal.baseFeeAtomsPerByte, 10_000n);
  assert.equal(normal.bufferedFeeAtomsPerByte, 12_000n);
  assert.equal(normal.pendingTxCount, 5);
  assert.equal(normal.formattedBaseFee, "10,000 atoms/B");
  assert.equal(normal.formattedBufferedFee, "12,000 atoms/B");

  // 3. elevated
  const elevated = classifyFeePressure(50_000n, 10);
  assert.equal(elevated.tier, "elevated");
  assert.equal(elevated.label, "Elevated");
  assert.equal(elevated.baseFeeAtomsPerByte, 50_000n);
  assert.equal(elevated.bufferedFeeAtomsPerByte, 60_000n);
  assert.equal(elevated.formattedBaseFee, "50,000 atoms/B");
  assert.equal(elevated.formattedBufferedFee, "60,000 atoms/B");

  // 4. congested
  const congested = classifyFeePressure(250_000n, 42);
  assert.equal(congested.tier, "congested");
  assert.equal(congested.label, "Congested");
  assert.equal(congested.baseFeeAtomsPerByte, 250_000n);
  assert.equal(congested.bufferedFeeAtomsPerByte, 300_000n);
  assert.equal(congested.formattedBaseFee, "250,000 atoms/B");
  assert.equal(congested.formattedBufferedFee, "300,000 atoms/B");

  // 5. unknown (null, undefined, negative, invalid strings)
  for (const invalid of [null, undefined, -1n, -100, Number.NaN, "", "   ", "-5", "not-a-fee", "0x"]) {
    const unknown = classifyFeePressure(invalid, null);
    assert.equal(unknown.tier, "unknown");
    assert.equal(unknown.label, "Unknown");
    assert.equal(unknown.baseFeeAtomsPerByte, null);
    assert.equal(unknown.bufferedFeeAtomsPerByte, null);
    assert.equal(unknown.pendingTxCount, null);
    assert.equal(unknown.formattedBaseFee, "n/a");
    assert.equal(unknown.formattedBufferedFee, "n/a");
  }
});

test("classifyFeePressure elevates tier when mempool pendingTxCount indicates congestion", () => {
  // Low base fee but elevated/congested mempool backlog
  assert.equal(classifyFeePressure(1_000n, 25).tier, "normal");
  assert.equal(classifyFeePressure(1_000n, 150).tier, "elevated");
  assert.equal(classifyFeePressure(1_000n, 600).tier, "congested");

  // Negative or non-finite pendingTxCount is normalized safely to null
  const normalized = classifyFeePressure(5_000n, -5);
  assert.equal(normalized.tier, "low");
  assert.equal(normalized.pendingTxCount, null);
});

test("classifyFeePressure accepts hex string, decimal string, number, and bigint inputs", () => {
  // Hex string: 0x2710 = 10,000
  const fromHex = classifyFeePressure("0x2710", 0);
  assert.equal(fromHex.tier, "normal");
  assert.equal(fromHex.baseFeeAtomsPerByte, 10_000n);
  assert.equal(fromHex.bufferedFeeAtomsPerByte, 12_000n);
  assert.equal(fromHex.formattedBaseFee, "10,000 atoms/B");
  assert.equal(fromHex.formattedBufferedFee, "12,000 atoms/B");

  // Uppercase hex with surrounding whitespace: 0x186A1 = 100,001 -> congested
  const fromUpperHex = classifyFeePressure("  0x186A1  ", 2);
  assert.equal(fromUpperHex.tier, "congested");
  assert.equal(fromUpperHex.baseFeeAtomsPerByte, 100_001n);
  assert.equal(fromUpperHex.bufferedFeeAtomsPerByte, 120_002n);

  // Decimal string
  const fromDecimal = classifyFeePressure("30000", 1);
  assert.equal(fromDecimal.tier, "elevated");
  assert.equal(fromDecimal.baseFeeAtomsPerByte, 30_000n);
  assert.equal(fromDecimal.bufferedFeeAtomsPerByte, 36_000n);

  // Number input
  const fromNumber = classifyFeePressure(500, 0);
  assert.equal(fromNumber.tier, "low");
  assert.equal(fromNumber.baseFeeAtomsPerByte, 500n);
  assert.equal(fromNumber.bufferedFeeAtomsPerByte, 600n);

  // BigInt input
  const fromBigInt = classifyFeePressure(7n, 0);
  assert.equal(fromBigInt.tier, "low");
  assert.equal(fromBigInt.baseFeeAtomsPerByte, 7n);
  assert.equal(fromBigInt.bufferedFeeAtomsPerByte, 9n);
});
