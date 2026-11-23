import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POOL_FROZEN_SPEC,
  summarizePoolStratumConfig,
} from "../src/lib/pool/stratum-summary";

test("POOL_FROZEN_SPEC exports frozen KovanicaHash emission and Stratum TLS constants", () => {
  assert.deepEqual(POOL_FROZEN_SPEC, {
    powAlgorithm: "KovanicaHash",
    ghostdag: "GHOSTDAG K=5",
    targetBlockTime: "4s",
    initialBlockReward: "2.5 KVNC",
    subsidyEraBlocks: 8_200_000,
    decayFactor: "3/4",
    feeSplit: "3/4 burn / 1/4 miner",
    tlsRequired: true,
    mainnetTag: "1-f35df34c92001436",
    testnetTag: "2-24cdb5fadd98b207",
  });
});

test("summarizePoolStratumConfig returns canonical mainnet Stratum summary", () => {
  const summary = summarizePoolStratumConfig("mainnet");

  assert.equal(summary.network, "mainnet");
  assert.equal(summary.label, "Mainnet (Chain 1)");
  assert.equal(summary.chainId, 1);
  assert.equal(summary.networkTag, "1-f35df34c92001436");
  assert.equal(summary.protocol, "Stratum v1");
  assert.equal(summary.tlsRequired, true);
  assert.equal(summary.varDiffMode, "adaptive");
  assert.equal(summary.gracefulDrainSupported, true);
  assert.equal(summary.gracefulDrainMethod, "client.reconnect");
  assert.deepEqual(summary.frozenSpec, POOL_FROZEN_SPEC);
});

test("summarizePoolStratumConfig returns canonical testnet Stratum summary", () => {
  const summary = summarizePoolStratumConfig("testnet");

  assert.equal(summary.network, "testnet");
  assert.equal(summary.label, "Testnet (Chain 2)");
  assert.equal(summary.chainId, 2);
  assert.equal(summary.networkTag, "2-24cdb5fadd98b207");
  assert.equal(summary.protocol, "Stratum v1");
  assert.equal(summary.tlsRequired, true);
  assert.equal(summary.varDiffMode, "adaptive");
  assert.equal(summary.gracefulDrainSupported, true);
  assert.equal(summary.gracefulDrainMethod, "client.reconnect");
  assert.deepEqual(summary.frozenSpec, POOL_FROZEN_SPEC);
});
