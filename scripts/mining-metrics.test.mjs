import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLOCKS_PER_ERA,
  INITIAL_BLOCK_REWARD_KVNC,
  TARGET_BLOCK_INTERVAL_MS,
  computeEmissionEra,
  computeObservedBlockInterval,
  formatCompactDifficulty,
  formatDifficultyValue,
  formatKvncReward,
  parseTargetBits,
} from "../src/lib/explorer/mining-metrics.ts";

test("computeEmissionEra handles era 0, era boundaries, and geometric 3/4 decay", () => {
  const era0 = computeEmissionEra(0);
  assert.ok(era0);
  assert.equal(era0.era, 0);
  assert.equal(era0.blockInEra, 0);
  assert.equal(era0.blocksRemaining, BLOCKS_PER_ERA);
  assert.equal(era0.progressPct, 0);
  assert.equal(era0.rewardKvnc, INITIAL_BLOCK_REWARD_KVNC);
  assert.equal(era0.nextEraRewardKvnc, 1.875);

  const midEra0 = computeEmissionEra(4_100_000);
  assert.ok(midEra0);
  assert.equal(midEra0.era, 0);
  assert.equal(midEra0.blockInEra, 4_100_000);
  assert.equal(midEra0.blocksRemaining, 4_100_000);
  assert.equal(midEra0.progressPct, 50);
  assert.equal(midEra0.rewardKvnc, 2.5);

  const era1Start = computeEmissionEra(BLOCKS_PER_ERA);
  assert.ok(era1Start);
  assert.equal(era1Start.era, 1);
  assert.equal(era1Start.blockInEra, 0);
  assert.equal(era1Start.rewardKvnc, 1.875);
  assert.equal(era1Start.nextEraRewardKvnc, 1.40625);

  const era3 = computeEmissionEra(BLOCKS_PER_ERA * 3 + 82_000);
  assert.ok(era3);
  assert.equal(era3.era, 3);
  assert.equal(era3.blockInEra, 82_000);
  assert.equal(era3.progressPct, 1);
  assert.equal(era3.rewardKvnc, 2.5 * Math.pow(0.75, 3));
});

test("computeEmissionEra returns null for invalid or missing height (never fakes zero)", () => {
  assert.equal(computeEmissionEra(null), null);
  assert.equal(computeEmissionEra(undefined), null);
  assert.equal(computeEmissionEra(-1), null);
  assert.equal(computeEmissionEra(Number.NaN), null);
  assert.equal(computeEmissionEra(Number.POSITIVE_INFINITY), null);
});

test("formatKvncReward formats KVNC cleanly without trailing zeros", () => {
  assert.equal(formatKvncReward(2.5), "2.5 KVNC");
  assert.equal(formatKvncReward(1.875), "1.875 KVNC");
  assert.equal(formatKvncReward(1.40625), "1.4063 KVNC");
  assert.equal(formatKvncReward(0), "0 KVNC");
  assert.equal(formatKvncReward(null), "n/a");
  assert.equal(formatKvncReward(-5), "n/a");
});

test("parseTargetBits parses uint32 numbers, 0x-prefixed hex, and decimal strings", () => {
  assert.equal(parseTargetBits(0x1d00ffff), 0x1d00ffff);
  assert.equal(parseTargetBits("0x1d00ffff"), 0x1d00ffff);
  assert.equal(parseTargetBits("0X1E0FFFFF"), 0x1e0fffff);
  assert.equal(parseTargetBits("1d00ffff"), 0x1d00ffff);
  assert.equal(parseTargetBits("486604799"), 0x1d00ffff);
  assert.equal(parseTargetBits(null), null);
  assert.equal(parseTargetBits(undefined), null);
  assert.equal(parseTargetBits(""), null);
  assert.equal(parseTargetBits(-1), null);
  assert.equal(parseTargetBits(0x100000000), null);
  assert.equal(parseTargetBits("not-a-number"), null);
});

test("formatCompactDifficulty decodes difficulty-1 compact bits (0x1d00ffff)", () => {
  const info = formatCompactDifficulty(0x1d00ffff);
  assert.ok(info);
  assert.equal(info.targetBits, 0x1d00ffff);
  assert.equal(info.targetBitsHex, "0x1d00ffff");
  assert.equal(info.exponent, 0x1d);
  assert.equal(info.mantissa, 0x00ffff);
  assert.equal(
    info.targetHex,
    "0x00000000ffff0000000000000000000000000000000000000000000000000000",
  );
  assert.equal(info.difficulty, 1);
  assert.equal(info.difficultyFormatted, "1.00");
});

test("formatCompactDifficulty prefers explicit node difficulty and handles missing values gracefully", () => {
  const withExplicit = formatCompactDifficulty("0x1e0fffff", 12500);
  assert.ok(withExplicit);
  assert.equal(withExplicit.targetBitsHex, "0x1e0fffff");
  assert.equal(withExplicit.difficulty, 12500);
  assert.equal(withExplicit.difficultyFormatted, "12.50 K");

  const explicitOnly = formatCompactDifficulty(null, 3_500_000);
  assert.ok(explicitOnly);
  assert.equal(explicitOnly.targetBits, null);
  assert.equal(explicitOnly.targetBitsHex, null);
  assert.equal(explicitOnly.difficultyFormatted, "3.50 M");

  assert.equal(formatCompactDifficulty(null, null), null);
  assert.equal(formatCompactDifficulty(undefined, 0), null);
});

test("formatDifficultyValue formats across SI scales and sub-unit testnet ranges", () => {
  assert.equal(formatDifficultyValue(null), "n/a");
  assert.equal(formatDifficultyValue(0), "n/a");
  assert.equal(formatDifficultyValue(0.0625), "0.0625");
  assert.equal(formatDifficultyValue(42.5), "42.50");
  assert.equal(formatDifficultyValue(2_500), "2.50 K");
  assert.equal(formatDifficultyValue(7_250_000), "7.25 M");
  assert.equal(formatDifficultyValue(9_100_000_000), "9.10 G");
  assert.equal(formatDifficultyValue(1_500_000_000_000), "1.50 T");
});

test("computeObservedBlockInterval computes mean interval and classifies fast/on-target/slow", () => {
  const onTarget = computeObservedBlockInterval([10_000, 14_000, 18_000, 22_000]);
  assert.ok(onTarget);
  assert.equal(onTarget.avgIntervalMs, TARGET_BLOCK_INTERVAL_MS);
  assert.equal(onTarget.avgIntervalSec, 4);
  assert.equal(onTarget.deltaFromTargetMs, 0);
  assert.equal(onTarget.sampleCount, 4);
  assert.equal(onTarget.status, "on-target");

  const fast = computeObservedBlockInterval([10_000, 12_000, 14_000]);
  assert.ok(fast);
  assert.equal(fast.avgIntervalSec, 2);
  assert.equal(fast.status, "fast");

  const slow = computeObservedBlockInterval([10_000, 16_000, 22_000]);
  assert.ok(slow);
  assert.equal(slow.avgIntervalSec, 6);
  assert.equal(slow.status, "slow");

  // Unsorted timestamps are handled cleanly
  const unsorted = computeObservedBlockInterval([22_000, 10_000, 18_000, 14_000]);
  assert.ok(unsorted);
  assert.equal(unsorted.avgIntervalSec, 4);
});

test("computeObservedBlockInterval returns null when insufficient or zero-span timestamps", () => {
  assert.equal(computeObservedBlockInterval([]), null);
  assert.equal(computeObservedBlockInterval([10_000]), null);
  assert.equal(computeObservedBlockInterval([10_000, 10_000]), null);
  assert.equal(computeObservedBlockInterval([0, -100]), null);
});
