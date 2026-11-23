import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIAGNOSTICS_SCHEMA_VERSION,
  buildExplorerDiagnosticsSnapshot,
  formatDiagnosticsJson,
  sanitizeDiagnosticText,
} from "../src/lib/explorer/diagnostics";
import type { ApiState } from "../src/lib/networkConstants";

function makeSampleState(overrides: Partial<ApiState> = {}): ApiState {
  return {
    selected: "0x3b6a",
    mining: false,
    faucet: false,
    allow_reset: false,
    operator: false,
    network: "kovanica-testnet",
    chain_id: 2,
    health: {
      state: "live",
      status: 200,
      checkedAt: 1_700_000_000_000,
    },
    listen: "0.0.0.0:8000",
    peers: ["seed1.kovanica.online:8000", "seed2.kovanica.online:8000"],
    mesh: {
      now: 1_700_000_000_000,
      queued: 0,
      nodes: [],
      events: [],
    },
    node: {
      blocks: 12450,
      tips: ["0xtip1", "0xtip2"],
      selected_tip: "0xtip1",
      blue_score: 12448,
      blue_work: 99999,
      k: 5,
      subsidy: 2_500_000_000,
      issuance: 2_500_000_000,
      halving_era: 8_200_000,
      min_fee: 5000,
      genesis: "0xgenesis",
      supply: 90_200_000_000_000_000,
      token: "KVNC",
      decimals: 9,
      miner: null,
      atom: 1_000_000_000,
      ui: "hybrid",
      utxos: 42,
      chain_len: 12450,
      mempool: 3,
      tx_count: 100,
      dag: [],
      order: [],
      pending: [],
    },
    wallets: [{ seed: 123456, address: "kvncsecretwallet", balance: 100 }],
    source: "testnet",
    ...overrides,
  };
}

test("buildExplorerDiagnosticsSnapshot verifies canonical testnet tag and metrics", () => {
  const fixedDate = "2026-11-23T12:00:00.000Z";
  const snapshot = buildExplorerDiagnosticsSnapshot({
    source: "testnet",
    transport: "ws",
    paused: false,
    state: makeSampleState(),
    error: null,
    errorStatus: null,
    generatedAt: fixedDate,
  });

  assert.equal(snapshot.schemaVersion, DIAGNOSTICS_SCHEMA_VERSION);
  assert.equal(snapshot.source, "testnet");
  assert.equal(snapshot.transport, "ws");
  assert.equal(snapshot.paused, false);
  assert.equal(snapshot.chainId, 2);
  assert.equal(snapshot.networkTag, "2-24cdb5fadd98b207");
  assert.equal(snapshot.networkTagVerified, true);
  assert.equal(snapshot.committedHeight, 12450);
  assert.equal(snapshot.blueScore, 12448);
  assert.equal(snapshot.peerCount, 2);
  assert.equal(snapshot.mempoolCount, 3);
  assert.equal(snapshot.tipCount, 2);
  assert.equal(snapshot.health, "live");
  assert.equal(snapshot.errorStatus, null);
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.generatedAt, fixedDate);

  // Must not leak wallet seeds or raw peer hostnames
  const serialized = formatDiagnosticsJson(snapshot);
  assert.ok(!serialized.includes("123456"), "must not leak wallet seed");
  assert.ok(!serialized.includes("kvncsecretwallet"), "must not leak wallet address");
  assert.ok(!serialized.includes("seed1.kovanica.online"), "must not leak raw peer endpoint");
});

test("buildExplorerDiagnosticsSnapshot verifies canonical mainnet tag", () => {
  const snapshot = buildExplorerDiagnosticsSnapshot({
    source: "mainnet",
    transport: "polling",
    paused: false,
    state: makeSampleState({ network: "kovanica-mainnet", chain_id: 1 }),
    generatedAt: "2027-01-01T00:00:00.000Z",
  });

  assert.equal(snapshot.chainId, 1);
  assert.equal(snapshot.networkTag, "1-f35df34c92001436");
  assert.equal(snapshot.networkTagVerified, true);
});

test("buildExplorerDiagnosticsSnapshot marks mismatched chain or network tag as unverified", () => {
  const wrongTag = buildExplorerDiagnosticsSnapshot({
    source: "testnet",
    transport: "polling",
    paused: false,
    state: {
      ...makeSampleState(),
      network_tag: "2-0000000000000000",
    },
    generatedAt: "2026-11-23T12:00:00.000Z",
  });
  assert.equal(wrongTag.networkTag, "2-0000000000000000");
  assert.equal(wrongTag.networkTagVerified, false);

  const crossNetwork = buildExplorerDiagnosticsSnapshot({
    source: "testnet",
    transport: "polling",
    paused: false,
    state: makeSampleState({ network: "kovanica-mainnet", chain_id: 1 }),
    generatedAt: "2026-11-23T12:00:00.000Z",
  });
  assert.equal(crossNetwork.networkTag, "1-f35df34c92001436");
  assert.equal(crossNetwork.networkTagVerified, false);
});

test("buildExplorerDiagnosticsSnapshot handles null state and 503 stalled errors", () => {
  const snapshot = buildExplorerDiagnosticsSnapshot({
    source: "testnet",
    transport: "reconnecting",
    paused: false,
    state: null,
    error: "Upstream returned 503",
    errorStatus: 503,
    generatedAt: "2026-11-23T12:00:00.000Z",
  });

  assert.equal(snapshot.chainId, null);
  assert.equal(snapshot.networkTag, null);
  assert.equal(snapshot.networkTagVerified, false);
  assert.equal(snapshot.committedHeight, null);
  assert.equal(snapshot.blueScore, null);
  assert.equal(snapshot.peerCount, null);
  assert.equal(snapshot.mempoolCount, null);
  assert.equal(snapshot.tipCount, null);
  assert.equal(snapshot.health, "stalled");
  assert.equal(snapshot.errorStatus, 503);
  assert.equal(snapshot.error, "Upstream returned 503");
});

test("sanitizeDiagnosticText strips auth tokens, cookies, URL credentials, JWTs, and private secrets", () => {
  const raw =
    "Failed https://admin:supersecret@node.local/rpc Authorization: Bearer tok_live_abc123; Cookie: sid=xyz987; token=my_secret_tok api_key=key123 mnemonic=abandon_ability private_key=deadbeef eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123456";

  const sanitized = sanitizeDiagnosticText(raw);
  assert.ok(sanitized !== null);
  assert.ok(!sanitized.includes("supersecret"), "URL password must be redacted");
  assert.ok(!sanitized.includes("tok_live_abc123"), "Bearer token must be redacted");
  assert.ok(!sanitized.includes("xyz987"), "Cookie value must be redacted");
  assert.ok(!sanitized.includes("my_secret_tok"), "token param must be redacted");
  assert.ok(!sanitized.includes("key123"), "api_key param must be redacted");
  assert.ok(!sanitized.includes("abandon_ability"), "mnemonic must be redacted");
  assert.ok(!sanitized.includes("deadbeef"), "private_key must be redacted");
  assert.ok(!sanitized.includes("eyJhbGciOiJIUzI1NiJ9"), "JWT must be redacted");
});

test("formatDiagnosticsJson produces pretty-printed valid JSON round-tripping the snapshot", () => {
  const snapshot = buildExplorerDiagnosticsSnapshot({
    source: "testnet",
    transport: "polling",
    paused: true,
    state: makeSampleState(),
    generatedAt: "2026-11-23T12:00:00.000Z",
  });

  const json = formatDiagnosticsJson(snapshot);
  assert.ok(json.includes('\n  "schemaVersion": 1,'), "JSON must be pretty-printed with 2 spaces");
  assert.deepEqual(JSON.parse(json), snapshot);
});
