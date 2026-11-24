import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateEcosystemHealthMatrix,
  formatCheckedAtMs,
  formatDifficultyRange,
  formatStaleRatio,
  normalizeCommsRelayHealth,
  normalizeIndexerIntegrity,
  normalizeRpcHealth,
  normalizeStratumWorkers,
} from "../src/lib/network/ecosystem-health";

test("normalizeRpcHealth parses a healthy RPC /health payload", () => {
  const result = normalizeRpcHealth({
    status: "ok",
    rpc_version: "0.3.0-node",
    mempool_pending: 14,
    height: 128_450,
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.rawStatus, "ok");
  assert.equal(result.rpcVersion, "0.3.0-node");
  assert.equal(result.mempoolPending, 14);
  assert.equal(result.height, 128_450);
  assert.equal(result.detail, undefined);
});

test("normalizeRpcHealth handles degraded status, partial payload, and unreachable error", () => {
  const syncing = normalizeRpcHealth({
    status: "syncing",
    height: 1024,
  });
  assert.equal(syncing.status, "degraded");
  assert.equal(syncing.rpcVersion, null);
  assert.equal(syncing.mempoolPending, null);
  assert.equal(syncing.height, 1024);
  assert.match(syncing.detail ?? "", /syncing/i);

  const missingStatus = normalizeRpcHealth({ height: 55 });
  assert.equal(missingStatus.status, "degraded");
  assert.match(missingStatus.detail ?? "", /missing rpc status/i);

  const unreachable = normalizeRpcHealth(null, "HTTP 503");
  assert.equal(unreachable.status, "offline");
  assert.equal(unreachable.detail, "HTTP 503");
});

test("normalizeIndexerIntegrity parses healthy, mismatch, and malformed payloads", () => {
  const healthy = normalizeIndexerIntegrity({
    ok: true,
    total_events: 48_210,
    checked_at_ms: 1_764_000_000_000,
  });
  assert.equal(healthy.status, "healthy");
  assert.equal(healthy.ok, true);
  assert.equal(healthy.totalEvents, 48_210);
  assert.equal(healthy.checkedAtMs, 1_764_000_000_000);

  const mismatch = normalizeIndexerIntegrity({
    ok: false,
    total_events: 48_210,
    checked_at_ms: 1_764_000_000_000,
  });
  assert.equal(mismatch.status, "degraded");
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.detail ?? "", /mismatch/i);

  const partial = normalizeIndexerIntegrity({ total_events: 120 });
  assert.equal(partial.status, "degraded");
  assert.equal(partial.ok, null);

  const malformed = normalizeIndexerIntegrity("not-json");
  assert.equal(malformed.status, "offline");
  assert.equal(malformed.totalEvents, null);
});

test("normalizeStratumWorkers parses worker summary, difficulty range, and stale ratio", () => {
  const healthy = normalizeStratumWorkers({
    worker_count: 18,
    summary: {
      min_difficulty: 256,
      median_difficulty: 1024,
      max_difficulty: 4096,
      stale_ratio: 0.025,
    },
  });
  assert.equal(healthy.status, "healthy");
  assert.equal(healthy.workerCount, 18);
  assert.equal(healthy.minDifficulty, 256);
  assert.equal(healthy.medianDifficulty, 1024);
  assert.equal(healthy.maxDifficulty, 4096);
  assert.equal(healthy.staleRatio, 0.025);
  assert.equal(healthy.staleRatioLabel, "2.5%");

  const highStale = normalizeStratumWorkers({
    worker_count: 12,
    summary: {
      min_difficulty: 128,
      median_difficulty: 512,
      max_difficulty: 2048,
      stale_ratio: 0.184,
    },
  });
  assert.equal(highStale.status, "degraded");
  assert.equal(highStale.staleRatioLabel, "18.4%");
  assert.match(highStale.detail ?? "", /stale share ratio/i);

  const noSummary = normalizeStratumWorkers({ worker_count: 0 });
  assert.equal(noSummary.status, "healthy");
  assert.equal(noSummary.workerCount, 0);
  assert.equal(noSummary.staleRatioLabel, "n/a");

  const emptyObj = normalizeStratumWorkers({});
  assert.equal(emptyObj.status, "offline");
});

test("normalizeCommsRelayHealth parses healthy, degraded, and offline relay payloads", () => {
  const healthy = normalizeCommsRelayHealth({
    status: "healthy",
    queued_envelopes: 3,
    active_mailboxes: 42,
  });
  assert.equal(healthy.status, "healthy");
  assert.equal(healthy.queuedEnvelopes, 3);
  assert.equal(healthy.activeMailboxes, 42);

  const backlogged = normalizeCommsRelayHealth({
    status: "backlogged",
    queued_envelopes: 950,
    active_mailboxes: 12,
  });
  assert.equal(backlogged.status, "degraded");
  assert.match(backlogged.detail ?? "", /backlogged/i);

  const offline = normalizeCommsRelayHealth({ status: "down" });
  assert.equal(offline.status, "offline");
  assert.equal(offline.queuedEnvelopes, null);
});

test("formatStaleRatio, formatDifficultyRange, and formatCheckedAtMs handle edge cases safely", () => {
  assert.equal(formatStaleRatio(0), "0.0%");
  assert.equal(formatStaleRatio(0.0375), "3.8%");
  assert.equal(formatStaleRatio(1), "100.0%");
  assert.equal(formatStaleRatio(2.5), "100.0%");
  assert.equal(formatStaleRatio(-0.1), "n/a");
  assert.equal(formatStaleRatio(Number.NaN), "n/a");
  assert.equal(formatStaleRatio(null), "n/a");
  assert.equal(formatStaleRatio(undefined), "n/a");

  assert.equal(formatDifficultyRange(100, 500, 1000), "100 / 500 / 1,000");
  assert.equal(formatDifficultyRange(null, 250.5, null), "n/a / 250.5 / n/a");
  assert.equal(formatDifficultyRange(null, null, null), "n/a");

  assert.equal(formatCheckedAtMs(Date.UTC(2026, 10, 24, 15, 30, 45)), "15:30:45 UTC");
  assert.equal(formatCheckedAtMs(0), "n/a");
  assert.equal(formatCheckedAtMs(null), "n/a");
});

test("evaluateEcosystemHealthMatrix returns healthy when all 4 services are healthy", () => {
  const matrix = evaluateEcosystemHealthMatrix({
    rpc: {
      payload: {
        status: "ok",
        rpc_version: "0.3.0-node",
        mempool_pending: 5,
        height: 9_001,
      },
    },
    indexer: {
      payload: {
        ok: true,
        total_events: 15_000,
        checked_at_ms: Date.UTC(2026, 10, 24, 12, 0, 0),
      },
    },
    stratum: {
      payload: {
        worker_count: 7,
        summary: {
          min_difficulty: 64,
          median_difficulty: 256,
          max_difficulty: 1024,
          stale_ratio: 0.012,
        },
      },
    },
    comms: {
      payload: {
        status: "ok",
        queued_envelopes: 0,
        active_mailboxes: 19,
      },
    },
  });

  assert.equal(matrix.overall, "healthy");
  assert.equal(matrix.healthyCount, 4);
  assert.equal(matrix.degradedCount, 0);
  assert.equal(matrix.offlineCount, 0);
  assert.equal(matrix.totalCount, 4);
  assert.deepEqual(
    matrix.services.map((s) => s.id),
    ["rpc", "indexer", "stratum", "comms"],
  );
});

test("evaluateEcosystemHealthMatrix returns degraded on partial outage or degraded service", () => {
  const matrix = evaluateEcosystemHealthMatrix({
    rpc: {
      payload: { status: "ok", height: 4200 },
    },
    indexer: {
      payload: { ok: false, total_events: 100 },
    },
    stratum: {
      error: "Connection refused",
    },
    comms: {
      error: "Endpoint not configured",
    },
  });

  assert.equal(matrix.overall, "degraded");
  assert.equal(matrix.healthyCount, 1);
  assert.equal(matrix.degradedCount, 1);
  assert.equal(matrix.offlineCount, 2);
  assert.equal(matrix.totalCount, 4);
});

test("evaluateEcosystemHealthMatrix returns offline when all 4 services are unreachable or missing", () => {
  const matrix = evaluateEcosystemHealthMatrix(null);

  assert.equal(matrix.overall, "offline");
  assert.equal(matrix.healthyCount, 0);
  assert.equal(matrix.degradedCount, 0);
  assert.equal(matrix.offlineCount, 4);
  assert.equal(matrix.totalCount, 4);
  for (const service of matrix.services) {
    assert.equal(service.status, "offline");
    assert.equal(service.summary, "Unavailable");
  }
});

test("evaluateEcosystemHealthMatrix resists negative, NaN, and array payloads safely", () => {
  const matrix = evaluateEcosystemHealthMatrix({
    rpc: {
      payload: {
        status: "ok",
        rpc_version: "   ",
        mempool_pending: -5,
        height: Number.NaN,
      },
    },
    indexer: {
      payload: ["invalid"],
    },
    stratum: {
      payload: {
        worker_count: -1,
        summary: {
          min_difficulty: "bad",
          median_difficulty: -10,
          max_difficulty: Infinity,
          stale_ratio: -0.5,
        },
      },
    },
    comms: {
      payload: {
        status: 123,
        queued_envelopes: -2,
        active_mailboxes: "many",
      },
    },
  });

  assert.equal(matrix.rpc.status, "healthy");
  assert.equal(matrix.rpc.rpcVersion, null);
  assert.equal(matrix.rpc.mempoolPending, null);
  assert.equal(matrix.rpc.height, null);
  assert.equal(matrix.indexer.status, "offline");
  assert.equal(matrix.stratum.status, "offline");
  assert.equal(matrix.comms.status, "offline");
  assert.equal(matrix.overall, "degraded");
});
