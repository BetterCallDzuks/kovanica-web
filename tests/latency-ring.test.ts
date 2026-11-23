import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LATENCY_RING_CAPACITY,
  classifySyncLag,
  pushLatencySample,
  summarizeLatencyRing,
  type LatencySample,
} from "../src/lib/explorer/latency-ring";

test("pushLatencySample enforces ring capacity eviction immutably", () => {
  assert.equal(DEFAULT_LATENCY_RING_CAPACITY, 20);

  let ring: LatencySample[] = [];
  for (let i = 1; i <= 25; i += 1) {
    const prevRef = ring;
    ring = pushLatencySample(ring, {
      latencyMs: i * 10,
      ok: true,
      timestampMs: 1_700_000_000_000 + i * 1000,
    });
    assert.notEqual(ring, prevRef, "pushLatencySample must return a new array");
  }

  assert.equal(ring.length, 20, "ring must be capped at default capacity of 20");
  assert.equal(ring[0].latencyMs, 60, "oldest 5 samples must be evicted");
  assert.equal(ring[19].latencyMs, 250, "newest sample must be retained at tail");

  // Custom capacity
  const smallRing = pushLatencySample(
    ring,
    { latencyMs: 300, ok: true, timestampMs: 1_700_000_030_000 },
    3,
  );
  assert.equal(smallRing.length, 3);
  assert.deepEqual(
    smallRing.map((s) => s.latencyMs),
    [240, 250, 300],
  );
});

test("pushLatencySample filters out NaN, Infinity, and negative latency values", () => {
  const initial: LatencySample[] = [
    { latencyMs: 15, ok: true, timestampMs: 1000 },
    { latencyMs: 25, ok: true, timestampMs: 2000 },
  ];

  const afterNaN = pushLatencySample(initial, {
    latencyMs: Number.NaN,
    ok: false,
    timestampMs: 3000,
  });
  assert.equal(afterNaN.length, 2);

  const afterNegative = pushLatencySample(afterNaN, {
    latencyMs: -5,
    ok: false,
    timestampMs: 4000,
  });
  assert.equal(afterNegative.length, 2);

  const afterInf = pushLatencySample(afterNegative, {
    latencyMs: Number.POSITIVE_INFINITY,
    ok: false,
    timestampMs: 5000,
  });
  assert.equal(afterInf.length, 2);

  // Zero latency is valid (fast local loopback)
  const afterZero = pushLatencySample(afterInf, {
    latencyMs: 0,
    ok: true,
    timestampMs: 6000,
  });
  assert.equal(afterZero.length, 3);
  assert.equal(afterZero[2].latencyMs, 0);
});

test("summarizeLatencyRing computes p50, p95, max, last, and ok/error counts accurately", () => {
  const empty = summarizeLatencyRing([]);
  assert.deepEqual(empty, {
    count: 0,
    okCount: 0,
    errorCount: 0,
    p50Ms: null,
    p95Ms: null,
    maxMs: null,
    lastMs: null,
    points: "",
  });

  // 20 samples: 10, 20, ..., 200 (with 3 errors)
  const samples: LatencySample[] = Array.from({ length: 20 }, (_, i) => ({
    latencyMs: (i + 1) * 10,
    ok: i % 7 !== 0, // indices 0, 7, 14 => 3 errors, 17 ok
    timestampMs: 1000 + i * 500,
  }));

  const summary = summarizeLatencyRing(samples, 160, 36);
  assert.equal(summary.count, 20);
  assert.equal(summary.okCount, 17);
  assert.equal(summary.errorCount, 3);
  assert.equal(summary.p50Ms, 100);
  assert.equal(summary.p95Ms, 190);
  assert.equal(summary.maxMs, 200);
  assert.equal(summary.lastMs, 200);

  const pointPairs = summary.points.split(" ");
  assert.equal(pointPairs.length, 20, "polyline must emit one point per sample");
  for (const pair of pointPairs) {
    assert.match(pair, /^\d+\.\d+,\d+\.\d+$/, `invalid SVG point format: ${pair}`);
    const [x, y] = pair.split(",").map(Number);
    assert.ok(x >= 0 && x <= 160, `x=${x} out of SVG bounds`);
    assert.ok(y >= 0 && y <= 36, `y=${y} out of SVG bounds`);
  }

  // Increasing latency => first point should have higher SVG y (lower on chart) than last point
  const firstY = Number(pointPairs[0].split(",")[1]);
  const lastY = Number(pointPairs[19].split(",")[1]);
  assert.ok(firstY > lastY, `expected firstY (${firstY}) > lastY (${lastY})`);
});

test("summarizeLatencyRing handles single-sample and flat-latency SVG polyline generation", () => {
  const single = summarizeLatencyRing([{ latencyMs: 42, ok: true, timestampMs: 1000 }], 160, 36);
  assert.equal(single.count, 1);
  assert.equal(single.p50Ms, 42);
  assert.equal(single.p95Ms, 42);
  assert.equal(single.maxMs, 42);
  assert.equal(single.lastMs, 42);
  const singlePairs = single.points.split(" ");
  assert.equal(singlePairs.length, 2, "single sample renders a horizontal baseline segment");
  assert.equal(singlePairs[0].split(",")[1], singlePairs[1].split(",")[1]);

  const flat = summarizeLatencyRing(
    [
      { latencyMs: 50, ok: true, timestampMs: 1000 },
      { latencyMs: 50, ok: true, timestampMs: 2000 },
      { latencyMs: 50, ok: true, timestampMs: 3000 },
    ],
    160,
    36,
  );
  const flatYs = flat.points.split(" ").map((p) => p.split(",")[1]);
  assert.equal(new Set(flatYs).size, 1, "flat latencies must produce constant y coordinates");
});

test("classifySyncLag classifies synced, lagging, stalled, and unknown states", () => {
  assert.deepEqual(classifySyncLag(12450, 12450), {
    status: "synced",
    lagBlocks: 0,
    label: "Synced",
  });

  // Local slightly ahead of peer highest still classifies as synced with 0 lag
  assert.deepEqual(classifySyncLag(12455, 12450), {
    status: "synced",
    lagBlocks: 0,
    label: "Synced",
  });

  // Within small tip tolerance (<= 2 blocks)
  assert.deepEqual(classifySyncLag(12448, 12450), {
    status: "synced",
    lagBlocks: 2,
    label: "Synced (-2 blk)",
  });

  // Lagging (3..20 blocks behind)
  assert.deepEqual(classifySyncLag(12440, 12450), {
    status: "lagging",
    lagBlocks: 10,
    label: "Lagging (-10 blks)",
  });

  // Stalled (> 20 blocks behind)
  assert.deepEqual(classifySyncLag(12400, 12450), {
    status: "stalled",
    lagBlocks: 50,
    label: "Stalled (-50 blks)",
  });

  // Unknown for null / undefined / NaN / negative inputs
  assert.deepEqual(classifySyncLag(null, 12450), {
    status: "unknown",
    lagBlocks: null,
    label: "Sync Unknown",
  });
  assert.deepEqual(classifySyncLag(12450, undefined), {
    status: "unknown",
    lagBlocks: null,
    label: "Sync Unknown",
  });
  assert.deepEqual(classifySyncLag(Number.NaN, 12450), {
    status: "unknown",
    lagBlocks: null,
    label: "Sync Unknown",
  });
  assert.deepEqual(classifySyncLag(-1, 12450), {
    status: "unknown",
    lagBlocks: null,
    label: "Sync Unknown",
  });
});
