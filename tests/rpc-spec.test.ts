import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TESTNET_RPC_URL,
  RPC_IDENTITY_HEADERS,
  RPC_MEMPOOL_STATS_METHOD,
  buildRpcBatchCurlExample,
} from "../src/lib/api/rpc-spec";

test("RPC_IDENTITY_HEADERS exposes canonical Kovanica RPC identity headers", () => {
  const names = RPC_IDENTITY_HEADERS.map((h) => h.name);
  assert.deepEqual(names, [
    "X-Kovanica-Chain-Id",
    "X-Kovanica-Network-Tag",
    "X-Kovanica-Rpc-Version",
  ]);

  for (const header of RPC_IDENTITY_HEADERS) {
    assert.ok(header.description.length > 0, `${header.name} must have a description`);
    assert.ok(header.example.length > 0, `${header.name} must have an example`);
  }

  const tagHeader = RPC_IDENTITY_HEADERS.find((h) => h.name === "X-Kovanica-Network-Tag");
  assert.equal(tagHeader?.example, "2-24cdb5fadd98b207");
});

test("RPC_MEMPOOL_STATS_METHOD documents all six fee-percentile snapshot fields", () => {
  assert.equal(RPC_MEMPOOL_STATS_METHOD.method, "kovanica_mempoolStats");
  assert.ok(RPC_MEMPOOL_STATS_METHOD.description.length > 0);
  assert.ok(RPC_MEMPOOL_STATS_METHOD.emptyBehavior.includes("null"));

  const fieldNames = RPC_MEMPOOL_STATS_METHOD.fields.map((f) => f.name);
  assert.deepEqual(fieldNames, [
    "pending_count",
    "total_bytes",
    "min_fee_per_byte",
    "p50_fee_per_byte",
    "p90_fee_per_byte",
    "max_fee_per_byte",
  ]);
});

test("buildRpcBatchCurlExample generates a single-POST JSON-RPC 2.0 batch curl -i command", () => {
  const cmd = buildRpcBatchCurlExample(DEFAULT_TESTNET_RPC_URL);
  assert.ok(cmd.startsWith(`curl -i -sS -X POST '${DEFAULT_TESTNET_RPC_URL}'`));
  assert.ok(cmd.includes("-H 'Content-Type: application/json'"));

  const payloadMatch = /-d '(.+)'$/s.exec(cmd);
  assert.ok(payloadMatch, "curl command must include single-quoted JSON batch payload");

  const parsed = JSON.parse(payloadMatch[1]) as Array<{
    jsonrpc: string;
    id: number;
    method: string;
    params: unknown[];
  }>;
  assert.equal(parsed.length, 3);
  assert.deepEqual(
    parsed.map((item) => item.method),
    ["kovanica_chainId", "kovanica_blockNumber", "kovanica_mempoolStats"],
  );
  for (const item of parsed) {
    assert.equal(item.jsonrpc, "2.0");
    assert.deepEqual(item.params, []);
  }

  // Local HTTP RPC URL is also accepted
  const localCmd = buildRpcBatchCurlExample("http://127.0.0.1:8545/rpc");
  assert.ok(localCmd.includes("'http://127.0.0.1:8545/rpc'"));
});

test("buildRpcBatchCurlExample rejects shell metacharacters and invalid URLs", () => {
  const invalidUrls = [
    "",
    "   ",
    "ftp://rpc.kovanica.online/rpc",
    "javascript:alert(1)",
    "not-a-url",
    "https://rpc.kovanica.online/rpc; rm -rf /",
    "https://rpc.kovanica.online/rpc$(whoami)",
    "https://rpc.kovanica.online/rpc`id`",
    "https://rpc.kovanica.online/rpc|cat",
    "https://rpc.kovanica.online/rpc&&echo",
    "https://rpc.kovanica.online/rpc'injected'",
    'https://rpc.kovanica.online/rpc"injected"',
    "https://rpc.kovanica.online/rpc\nX-Injected: 1",
    "https://rpc.kovanica.online/rpc --next",
    "https://rpc.kovanica.online/rpc\\path",
  ];

  for (const badUrl of invalidUrls) {
    assert.throws(
      () => buildRpcBatchCurlExample(badUrl),
      /RPC URL/,
      `Expected rejection for unsafe/invalid URL: ${JSON.stringify(badUrl)}`,
    );
  }
});
