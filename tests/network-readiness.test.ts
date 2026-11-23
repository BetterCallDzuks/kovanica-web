import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_NETWORK_IDENTITIES,
  FROZEN_CONSENSUS_CONSTANTS,
  evaluateServiceReadiness,
} from "../src/lib/network/readiness";

test("CANONICAL_NETWORK_IDENTITIES exports frozen Mainnet (Chain 1) and Testnet (Chain 2) tags", () => {
  assert.deepEqual(CANONICAL_NETWORK_IDENTITIES.mainnet, {
    chainId: 1,
    networkTag: "1-f35df34c92001436",
    label: "Mainnet (Chain 1)",
  });
  assert.deepEqual(CANONICAL_NETWORK_IDENTITIES.testnet, {
    chainId: 2,
    networkTag: "2-24cdb5fadd98b207",
    label: "Testnet (Chain 2)",
  });
  assert.deepEqual(FROZEN_CONSENSUS_CONSTANTS, {
    powAlgorithm: "KovanicaHash",
    ghostdag: "GHOSTDAG K=5",
    targetBlockTime: "4s",
  });
});

test("evaluateServiceReadiness returns operational when all services are operational", () => {
  const report = evaluateServiceReadiness([
    { name: "Testnet RPC", status: "operational", detail: "seed1" },
    { name: "Explorer", status: "operational" },
    { name: "Faucet", status: "operational", detail: "PRO-21" },
  ]);

  assert.equal(report.overall, "operational");
  assert.equal(report.healthyCount, 3);
  assert.equal(report.totalCount, 3);
  assert.deepEqual(report.alerts, []);
});

test("evaluateServiceReadiness returns degraded when at least one service is degraded and none are offline", () => {
  const report = evaluateServiceReadiness([
    { name: "Testnet RPC", status: "operational" },
    { name: "Indexer", status: "degraded", detail: "lagging 12 blocks" },
    { name: "Faucet", status: "degraded" },
  ]);

  assert.equal(report.overall, "degraded");
  assert.equal(report.healthyCount, 1);
  assert.equal(report.totalCount, 3);
  assert.deepEqual(report.alerts, [
    "Indexer: degraded (lagging 12 blocks)",
    "Faucet: degraded",
  ]);
});

test("evaluateServiceReadiness returns offline when any service is offline", () => {
  const report = evaluateServiceReadiness([
    { name: "Consensus Spec", status: "operational" },
    { name: "Indexer", status: "degraded", detail: "catching up" },
    { name: "Mainnet RPC", status: "offline", detail: "Launching 1.1.2027" },
  ]);

  assert.equal(report.overall, "offline");
  assert.equal(report.healthyCount, 1);
  assert.equal(report.totalCount, 3);
  assert.deepEqual(report.alerts, [
    "Indexer: degraded (catching up)",
    "Mainnet RPC: offline (Launching 1.1.2027)",
  ]);
});

test("evaluateServiceReadiness handles empty service list truthfully as offline", () => {
  const report = evaluateServiceReadiness([]);

  assert.equal(report.overall, "offline");
  assert.equal(report.healthyCount, 0);
  assert.equal(report.totalCount, 0);
  assert.equal(report.alerts.length, 1);
  assert.match(report.alerts[0] ?? "", /no ecosystem services/i);
});
