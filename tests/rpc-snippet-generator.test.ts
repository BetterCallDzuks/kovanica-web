import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TESTNET_RPC_URL } from "../src/lib/api/rpc-spec";
import {
  KOVANICA_SDK_VERSION,
  RPC_METHOD_CATALOG,
  RPC_METHOD_CATEGORIES,
  buildCurlSnippet,
  buildSdkSnippet,
  deriveHealthUrl,
  filterRpcMethods,
  getRpcMethodById,
  quotePosixShellArg,
  validateRpcSnippetUrl,
} from "../src/lib/api/rpc-snippet-generator";

test("RPC_METHOD_CATALOG covers all required methods and categories", () => {
  assert.deepEqual(RPC_METHOD_CATEGORIES, [
    "Chain",
    "Accounts",
    "Contracts",
    "Mempool",
    "Health",
  ]);

  const methodNames = RPC_METHOD_CATALOG.map((entry) => entry.method);
  const expectedMethods = [
    "kovanica_blockNumber",
    "kovanica_getBlockByHeight",
    "kovanica_getBalance",
    "kovanica_getTransactionHistory",
    "kovanica_getLogs",
    "kovanica_getStorageAt",
    "kovanica_call",
    "kovanica_mempoolStats",
    "GET /health",
  ];

  for (const method of expectedMethods) {
    assert.ok(methodNames.includes(method), `Missing expected catalog method: ${method}`);
  }

  // Unique IDs and non-empty metadata
  const ids = new Set(RPC_METHOD_CATALOG.map((entry) => entry.id));
  assert.equal(ids.size, RPC_METHOD_CATALOG.length);
  for (const entry of RPC_METHOD_CATALOG) {
    assert.ok(entry.summary.length > 0);
    assert.ok(entry.description.length > 0);
    assert.ok(entry.sdkHelper.length > 0);
  }
});

test("filterRpcMethods filters by category, case-insensitive query, and combined criteria", () => {
  assert.equal(filterRpcMethods("", "All").length, RPC_METHOD_CATALOG.length);

  const contractMethods = filterRpcMethods("", "Contracts");
  assert.deepEqual(
    contractMethods.map((m) => m.method),
    ["kovanica_getLogs", "kovanica_getStorageAt", "kovanica_call"],
  );

  const mempoolSearch = filterRpcMethods("FEE-RATE", "All");
  assert.deepEqual(
    mempoolSearch.map((m) => m.method),
    ["kovanica_mempoolStats"],
  );

  // Matches SDK helper name as well
  const sdkHelperSearch = filterRpcMethods("queryContractLogsPaginated", "All");
  assert.deepEqual(
    sdkHelperSearch.map((m) => m.method),
    ["kovanica_getLogs"],
  );

  // Combined category + search
  const combined = filterRpcMethods("balance", "Accounts");
  assert.deepEqual(
    combined.map((m) => m.method),
    ["kovanica_getBalance"],
  );

  // Mismatched category yields empty list
  assert.deepEqual(filterRpcMethods("balance", "Chain"), []);
  assert.deepEqual(filterRpcMethods("nonexistent_rpc_method_xyz", "All"), []);
});

test("buildCurlSnippet generates shell-safe POSIX single-quoted curl commands", () => {
  const blockNumber = getRpcMethodById("kovanica_blockNumber");
  assert.ok(blockNumber);

  const cmd = buildCurlSnippet(blockNumber, DEFAULT_TESTNET_RPC_URL);
  assert.ok(cmd.startsWith(`curl -sS -X POST '${DEFAULT_TESTNET_RPC_URL}' \\`));
  assert.ok(cmd.includes("-H 'Content-Type: application/json'"));

  const payloadMatch = /-d '(.+)'$/s.exec(cmd);
  assert.ok(payloadMatch, "Expected single-quoted JSON payload");
  const parsed = JSON.parse(payloadMatch[1]) as {
    jsonrpc: string;
    id: number;
    method: string;
    params: unknown[];
  };
  assert.equal(parsed.jsonrpc, "2.0");
  assert.equal(parsed.id, 1);
  assert.equal(parsed.method, "kovanica_blockNumber");
  assert.deepEqual(parsed.params, []);

  // GET /health uses HTTP GET and derives /health from /rpc
  const health = getRpcMethodById("GET /health");
  assert.ok(health);
  const healthCmd = buildCurlSnippet(health, "https://api.kovanica.online/rpc");
  assert.equal(healthCmd, "curl -i -sS -X GET 'https://api.kovanica.online/health'");

  assert.equal(deriveHealthUrl("http://127.0.0.1:8545/rpc"), "http://127.0.0.1:8545/health");
  assert.equal(deriveHealthUrl("http://127.0.0.1:8545/health"), "http://127.0.0.1:8545/health");
  assert.equal(deriveHealthUrl("http://127.0.0.1:8545"), "http://127.0.0.1:8545/health");
});

test("buildSdkSnippet generates kovanica-sdk v0.7.0 TypeScript snippets using exported helpers", () => {
  const expectations: ReadonlyArray<{ id: string; expectedSymbol: string }> = [
    { id: "kovanica_blockNumber", expectedSymbol: "client.blockNumber()" },
    { id: "kovanica_getBlockByHeight", expectedSymbol: "client.getBlockByHeight(" },
    { id: "kovanica_getBalance", expectedSymbol: "client.getBalance(" },
    { id: "kovanica_getTransactionHistory", expectedSymbol: "getAccountTxHistory" },
    { id: "kovanica_getLogs", expectedSymbol: "queryContractLogsPaginated" },
    { id: "kovanica_getStorageAt", expectedSymbol: "readContractStorage" },
    { id: "kovanica_call", expectedSymbol: "dryRunCall" },
    { id: "kovanica_mempoolStats", expectedSymbol: "estimatePriorityFeeTiers" },
    { id: "GET /health", expectedSymbol: "probeRpcNode" },
  ];

  const customUrl = "https://rpc.kovanica.online/rpc";
  for (const { id, expectedSymbol } of expectations) {
    const entry = getRpcMethodById(id);
    assert.ok(entry, `Expected method ${id} in catalog`);
    const snippet = buildSdkSnippet(entry, customUrl);
    assert.ok(
      snippet.includes(`kovanica-sdk v${KOVANICA_SDK_VERSION}`),
      `Snippet for ${id} should reference kovanica-sdk v${KOVANICA_SDK_VERSION}`,
    );
    assert.ok(
      snippet.includes('from "kovanica-sdk"'),
      `Snippet for ${id} should import from kovanica-sdk`,
    );
    assert.ok(
      snippet.includes(expectedSymbol),
      `Snippet for ${id} should include ${expectedSymbol}`,
    );
    assert.ok(
      snippet.includes(JSON.stringify(customUrl)),
      `Snippet for ${id} should include sanitized RPC URL`,
    );
  }
});

test("validateRpcSnippetUrl and snippet builders reject control characters, shell metacharacters, and invalid URLs", () => {
  const invalidUrls = [
    "",
    "   ",
    "ftp://api.kovanica.online/rpc",
    "javascript:alert(1)",
    "not-a-valid-url",
    "https://api.kovanica.online/rpc; rm -rf /",
    "https://api.kovanica.online/rpc$(whoami)",
    "https://api.kovanica.online/rpc`id`",
    "https://api.kovanica.online/rpc|cat",
    "https://api.kovanica.online/rpc&&echo",
    "https://api.kovanica.online/rpc'injected'",
    'https://api.kovanica.online/rpc"injected"',
    "https://api.kovanica.online/rpc\nX-Injected: 1",
    "https://api.kovanica.online/rpc\r\nHost: evil.example",
    "https://api.kovanica.online/rpc\u0000null",
    "https://api.kovanica.online/rpc\u007fdel",
    "https://api.kovanica.online/rpc\t--next",
    "https://api.kovanica.online/rpc --next",
    "https://api.kovanica.online/rpc\\path",
  ];

  const blockNumber = getRpcMethodById("kovanica_blockNumber")!;
  for (const badUrl of invalidUrls) {
    assert.throws(
      () => validateRpcSnippetUrl(badUrl),
      /RPC URL/,
      `validateRpcSnippetUrl must reject ${JSON.stringify(badUrl)}`,
    );
    assert.throws(
      () => buildCurlSnippet(blockNumber, badUrl),
      /RPC URL/,
      `buildCurlSnippet must reject ${JSON.stringify(badUrl)}`,
    );
    assert.throws(
      () => buildSdkSnippet(blockNumber, badUrl),
      /RPC URL/,
      `buildSdkSnippet must reject ${JSON.stringify(badUrl)}`,
    );
  }

  // quotePosixShellArg safely escapes embedded single quotes and rejects control chars
  assert.equal(quotePosixShellArg("a'b"), "'a'\\''b'");
  assert.throws(() => quotePosixShellArg("bad\nline"), /control characters/);
});
