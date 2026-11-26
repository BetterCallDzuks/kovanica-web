import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ROUTES,
  evaluateVerdict,
  parseArgs,
  parseChainIdFromNetworkTag,
  parseNumericRpcResult,
  probeRoute,
  probeRpc,
  runSyntheticProbe,
} from "./synthetic-health-probe.mjs";

function makeJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    async json() {
      return body;
    },
  };
}

function makeHtmlResponse(status = 200, location = null) {
  const headers = new Headers({ "content-type": "text/html" });
  if (location) headers.set("location", location);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
  };
}

test("parseNumericRpcResult and parseChainIdFromNetworkTag handle numbers, hex, networkTag, and invalid values", () => {
  assert.equal(parseNumericRpcResult(2), 2);
  assert.equal(parseNumericRpcResult("2"), 2);
  assert.equal(parseNumericRpcResult("0x2"), 2);
  assert.equal(parseNumericRpcResult("0x1e240"), 123456);
  assert.equal(parseNumericRpcResult(null), null);
  assert.equal(parseNumericRpcResult("not-a-number"), null);
  assert.equal(parseChainIdFromNetworkTag("2-24cdb5fadd98b207"), 2);
  assert.equal(parseChainIdFromNetworkTag("1-abcdef"), 1);
  assert.equal(parseChainIdFromNetworkTag("invalid"), null);
});

test("probeRpc falls back to kovanica_syncStatus.networkTag when kovanica_chainId returns -32601", async () => {
  const res = await probeRpc({
    expectedChainId: 2,
    latencyWarnMs: 5_000,
    fetchImpl: async (_url, init) => {
      const req = JSON.parse(init.body);
      if (req.method === "kovanica_chainId") {
        return makeJsonResponse({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32601, message: "Method not found: kovanica_chainId" },
        });
      }
      if (req.method === "kovanica_syncStatus") {
        return makeJsonResponse({
          jsonrpc: "2.0",
          id: req.id,
          result: { networkTag: "2-24cdb5fadd98b207", committedHeight: 137543 },
        });
      }
      if (req.method === "kovanica_blockNumber") {
        return makeJsonResponse({ jsonrpc: "2.0", id: req.id, result: "0x21947" });
      }
      throw new Error(`Unexpected method ${req.method}`);
    },
  });

  assert.equal(res.status, "ok");
  assert.equal(res.chainId, 2);
  assert.equal(res.chainIdMethod, "kovanica_syncStatus");
  assert.equal(res.networkTag, "2-24cdb5fadd98b207");
  assert.equal(res.blockNumber, 137543);
});

test("parseArgs parses --json, --strict, --timeout-ms, --warn-ms, and custom URLs", () => {
  const opts = parseArgs([
    "--json",
    "--strict",
    "--rpc-url",
    "https://example.invalid/rpc",
    "--web-url",
    "https://web.invalid/",
    "--chain-id",
    "1",
    "--timeout-ms",
    "5000",
    "--warn-ms",
    "1200",
  ]);
  assert.equal(opts.json, true);
  assert.equal(opts.strict, true);
  assert.equal(opts.rpcUrl, "https://example.invalid/rpc");
  assert.equal(opts.webBaseUrl, "https://web.invalid");
  assert.equal(opts.expectedChainId, 1);
  assert.equal(opts.timeoutMs, 5000);
  assert.equal(opts.latencyWarnMs, 1200);
});

test("runSyntheticProbe returns healthy (exitCode 0) when Chain 2 RPC and all routes succeed", async () => {
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith("/rpc")) {
      const req = JSON.parse(init.body);
      if (req.method === "kovanica_chainId") {
        return makeJsonResponse({ jsonrpc: "2.0", id: req.id, result: 2 });
      }
      if (req.method === "kovanica_blockNumber") {
        return makeJsonResponse({ jsonrpc: "2.0", id: req.id, result: "0x1f400" });
      }
    }
    if (String(url).endsWith("/privacy")) {
      return makeHtmlResponse(308, "https://kovanica.online/privacy/");
    }
    return makeHtmlResponse(200);
  };

  const report = await runSyntheticProbe({
    fetchImpl,
    latencyWarnMs: 5_000,
  });

  assert.equal(report.verdict, "healthy");
  assert.equal(report.healthy, true);
  assert.equal(report.exitCode, 0);
  assert.equal(report.rpc.status, "ok");
  assert.equal(report.rpc.chainId, 2);
  assert.equal(report.rpc.blockNumber, 0x1f400);
  assert.equal(report.routes.length, DEFAULT_ROUTES.length);
  assert.ok(report.routes.every((r) => r.status === "ok"));
  assert.equal(report.failures.length, 0);
  assert.equal(report.warnings.length, 0);
});

test("evaluateVerdict marks degraded when latency exceeds threshold (exitCode 0 default, 1 in strict mode)", () => {
  const rpc = {
    url: "https://rpc-testnet.kovanica.online/rpc",
    status: "degraded",
    chainId: 2,
    blockNumber: 120_000,
    latencyMs: 3200,
    warnings: ["High RPC latency: 3200ms >= 2500ms threshold"],
  };
  const routes = [
    { route: "/swap", status: "ok", httpStatus: 200, latencyMs: 120, warnings: [] },
  ];

  const relaxed = evaluateVerdict({ rpc, routes, strict: false });
  assert.equal(relaxed.verdict, "degraded");
  assert.equal(relaxed.healthy, true);
  assert.equal(relaxed.exitCode, 0);
  assert.equal(relaxed.warnings.length, 1);

  const strict = evaluateVerdict({ rpc, routes, strict: true });
  assert.equal(strict.verdict, "degraded");
  assert.equal(strict.healthy, false);
  assert.equal(strict.exitCode, 1);
});

test("probeRpc fails on wrong chainId or zero blockNumber", async () => {
  const wrongChain = await probeRpc({
    expectedChainId: 2,
    fetchImpl: async (_url, init) => {
      const req = JSON.parse(init.body);
      return makeJsonResponse({
        jsonrpc: "2.0",
        id: req.id,
        result: req.method === "kovanica_chainId" ? 1 : 500,
      });
    },
  });
  assert.equal(wrongChain.status, "fail");
  assert.match(wrongChain.error, /Chain ID mismatch/);

  const zeroBlock = await probeRpc({
    expectedChainId: 2,
    fetchImpl: async (_url, init) => {
      const req = JSON.parse(init.body);
      return makeJsonResponse({
        jsonrpc: "2.0",
        id: req.id,
        result: req.method === "kovanica_chainId" ? 2 : 0,
      });
    },
  });
  assert.equal(zeroBlock.status, "fail");
  assert.match(zeroBlock.error, /Invalid block number/);
});

test("probeRpc and probeRoute handle request timeouts cleanly and return failed verdict", async () => {
  const hangingFetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });

  const report = await runSyntheticProbe({
    routes: ["/swap"],
    timeoutMs: 30,
    fetchImpl: hangingFetch,
  });

  assert.equal(report.verdict, "failed");
  assert.equal(report.healthy, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.rpc.status, "fail");
  assert.equal(report.rpc.timedOut, true);
  assert.match(report.rpc.error, /timed out/i);
  assert.equal(report.routes[0].status, "fail");
  assert.equal(report.routes[0].timedOut, true);
});

test("probeRoute fails on HTTP 500 or 404 responses", async () => {
  const failed = await probeRoute({
    route: "/stealth",
    fetchImpl: async () => makeHtmlResponse(502),
  });
  assert.equal(failed.status, "fail");
  assert.equal(failed.httpStatus, 502);
  assert.match(failed.error, /Unexpected HTTP status 502/);
});
