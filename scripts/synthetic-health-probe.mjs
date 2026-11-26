#!/usr/bin/env node
/**
 * Kovanica Live Testnet Synthetic Health & Regression Probe.
 *
 * Zero external dependencies (Node 20+ native `fetch`).
 * Checks:
 *   1. Testnet JSON-RPC (`https://rpc-testnet.kovanica.online/rpc`):
 *      - `kovanica_chainId` == 2 (Chain 2 Testnet)
 *      - `kovanica_blockNumber` > 0
 *      - Response latency (warns if degraded)
 *   2. Key `https://kovanica.online` web routes (`/swap`, `/pools`, `/stealth`,
 *      `/explorer`, `/privacy`) returning HTTP 200 or an expected redirect (301/302/307/308).
 *
 * Exit codes:
 *   0 — healthy (or degraded warning when --strict is not set)
 *   1 — one or more checks failed (or degraded when --strict is set)
 *
 * Usage:
 *   node scripts/synthetic-health-probe.mjs
 *   node scripts/synthetic-health-probe.mjs --json
 *   node scripts/synthetic-health-probe.mjs --json --strict --timeout-ms 8000
 */

import { pathToFileURL } from "node:url";

export const DEFAULT_RPC_URL = "https://rpc-testnet.kovanica.online/rpc";
export const DEFAULT_WEB_BASE_URL = "https://kovanica.online";
export const DEFAULT_ROUTES = ["/swap", "/pools", "/stealth", "/explorer", "/privacy"];
export const DEFAULT_EXPECTED_CHAIN_ID = 2;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_LATENCY_WARN_MS = 2_500;

const EXPECTED_REDIRECT_STATUSES = new Set([301, 302, 307, 308]);

export function parseArgs(argv) {
  const opts = {
    json: false,
    strict: false,
    rpcUrl: DEFAULT_RPC_URL,
    webBaseUrl: DEFAULT_WEB_BASE_URL,
    routes: [...DEFAULT_ROUTES],
    expectedChainId: DEFAULT_EXPECTED_CHAIN_ID,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    latencyWarnMs: DEFAULT_LATENCY_WARN_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--strict") {
      opts.strict = true;
    } else if (arg === "--rpc-url" && argv[i + 1]) {
      opts.rpcUrl = argv[++i];
    } else if (arg === "--web-url" && argv[i + 1]) {
      opts.webBaseUrl = argv[++i].replace(/\/+$/, "");
    } else if (arg === "--chain-id" && argv[i + 1]) {
      opts.expectedChainId = Number.parseInt(argv[++i], 10);
    } else if (arg === "--timeout-ms" && argv[i + 1]) {
      opts.timeoutMs = Number.parseInt(argv[++i], 10);
    } else if (arg === "--warn-ms" && argv[i + 1]) {
      opts.latencyWarnMs = Number.parseInt(argv[++i], 10);
    } else if (arg === "--routes" && argv[i + 1]) {
      opts.routes = argv[++i]
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
    }
  }

  return opts;
}

/** Parse a JSON-RPC numeric result (number, decimal string, or 0x-hex string). */
export function parseNumericRpcResult(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 16);
    }
    if (/^\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }
  }
  return null;
}

/** Extract numeric chainId from a Kovanica `networkTag` (e.g. `"2-24cdb5fadd98b207"` -> `2`). */
export function parseChainIdFromNetworkTag(networkTag) {
  if (typeof networkTag !== "string") return null;
  const match = /^(\d+)-/.exec(networkTag.trim());
  return match ? Number.parseInt(match[1], 10) : null;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
  const start = performance.now();
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const latencyMs = Math.round(performance.now() - start);
    return { res, latencyMs };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const timedOut =
      controller.signal.aborted ||
      (err instanceof Error && (err.name === "AbortError" || /timeout/i.test(err.message)));
    const reason = timedOut
      ? `Request timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    const wrapped = new Error(reason);
    wrapped.timedOut = timedOut;
    wrapped.latencyMs = latencyMs;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

async function jsonRpcCall(fetchImpl, rpcUrl, method, id, timeoutMs) {
  const { res, latencyMs } = await fetchWithTimeout(
    fetchImpl,
    rpcUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "kovanica-synthetic-probe/1.0",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params: [] }),
    },
    timeoutMs,
  );

  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status} from ${method}`), {
      httpStatus: res.status,
      latencyMs,
    });
  }

  const payload = await res.json();
  if (payload?.error) {
    throw Object.assign(
      new Error(`RPC error (${payload.error.code ?? "unknown"}): ${payload.error.message ?? "error"}`),
      { latencyMs, rpcErrorCode: payload.error.code },
    );
  }
  return { result: payload?.result, latencyMs, httpStatus: res.status };
}

async function resolveChainId(fetchImpl, rpcUrl, timeoutMs) {
  try {
    const chainCall = await jsonRpcCall(fetchImpl, rpcUrl, "kovanica_chainId", 1, timeoutMs);
    return {
      chainId: parseNumericRpcResult(chainCall.result),
      chainIdMethod: "kovanica_chainId",
      networkTag: null,
      latencyMs: chainCall.latencyMs,
    };
  } catch (err) {
    // Live Kovanica L1 nodes may expose chain identity via `kovanica_syncStatus.networkTag`
    // (`"2-<genesis>"`) instead of a standalone `kovanica_chainId` method (-32601).
    if (err?.rpcErrorCode !== -32601) {
      throw err;
    }
    const syncCall = await jsonRpcCall(fetchImpl, rpcUrl, "kovanica_syncStatus", 3, timeoutMs);
    const networkTag =
      syncCall.result && typeof syncCall.result.networkTag === "string"
        ? syncCall.result.networkTag
        : null;
    return {
      chainId: parseChainIdFromNetworkTag(networkTag),
      chainIdMethod: "kovanica_syncStatus",
      networkTag,
      latencyMs: syncCall.latencyMs,
    };
  }
}

export async function probeRpc({
  rpcUrl = DEFAULT_RPC_URL,
  expectedChainId = DEFAULT_EXPECTED_CHAIN_ID,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  latencyWarnMs = DEFAULT_LATENCY_WARN_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  const warnings = [];
  try {
    const [chainInfo, blockCall] = await Promise.all([
      resolveChainId(fetchImpl, rpcUrl, timeoutMs),
      jsonRpcCall(fetchImpl, rpcUrl, "kovanica_blockNumber", 2, timeoutMs),
    ]);

    const chainId = chainInfo.chainId;
    const blockNumber = parseNumericRpcResult(blockCall.result);
    const latencyMs = Math.max(chainInfo.latencyMs, blockCall.latencyMs);

    if (chainId !== expectedChainId) {
      return {
        url: rpcUrl,
        status: "fail",
        chainId,
        chainIdMethod: chainInfo.chainIdMethod,
        networkTag: chainInfo.networkTag,
        expectedChainId,
        blockNumber,
        latencyMs,
        timedOut: false,
        error: `Chain ID mismatch: expected ${expectedChainId}, got ${String(chainId)}`,
        warnings,
      };
    }

    if (blockNumber === null || blockNumber <= 0) {
      return {
        url: rpcUrl,
        status: "fail",
        chainId,
        chainIdMethod: chainInfo.chainIdMethod,
        networkTag: chainInfo.networkTag,
        expectedChainId,
        blockNumber,
        latencyMs,
        timedOut: false,
        error: `Invalid block number: expected > 0, got ${String(blockNumber)}`,
        warnings,
      };
    }

    if (latencyMs >= latencyWarnMs) {
      warnings.push(`High RPC latency: ${latencyMs}ms >= ${latencyWarnMs}ms threshold`);
    }

    return {
      url: rpcUrl,
      status: warnings.length > 0 ? "degraded" : "ok",
      chainId,
      chainIdMethod: chainInfo.chainIdMethod,
      networkTag: chainInfo.networkTag,
      expectedChainId,
      blockNumber,
      latencyMs,
      timedOut: false,
      warnings,
    };
  } catch (err) {
    return {
      url: rpcUrl,
      status: "fail",
      chainId: null,
      chainIdMethod: null,
      networkTag: null,
      expectedChainId,
      blockNumber: null,
      latencyMs: typeof err?.latencyMs === "number" ? err.latencyMs : null,
      timedOut: Boolean(err?.timedOut),
      error: err instanceof Error ? err.message : String(err),
      warnings,
    };
  }
}

export async function probeRoute({
  baseUrl = DEFAULT_WEB_BASE_URL,
  route,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  latencyWarnMs = DEFAULT_LATENCY_WARN_MS,
  fetchImpl = globalThis.fetch,
}) {
  const url = `${baseUrl.replace(/\/+$/, "")}${route.startsWith("/") ? route : `/${route}`}`;
  const warnings = [];
  try {
    const { res, latencyMs } = await fetchWithTimeout(
      fetchImpl,
      url,
      {
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "user-agent": "kovanica-synthetic-probe/1.0",
        },
      },
      timeoutMs,
    );

    const httpStatus = res.status;
    const location = res.headers?.get?.("location") ?? null;
    const isOk = httpStatus === 200 || EXPECTED_REDIRECT_STATUSES.has(httpStatus);

    if (!isOk) {
      return {
        route,
        url,
        status: "fail",
        httpStatus,
        location,
        latencyMs,
        timedOut: false,
        error: `Unexpected HTTP status ${httpStatus} for ${route}`,
        warnings,
      };
    }

    if (latencyMs >= latencyWarnMs) {
      warnings.push(`High route latency: ${latencyMs}ms >= ${latencyWarnMs}ms threshold`);
    }

    return {
      route,
      url,
      status: warnings.length > 0 ? "degraded" : "ok",
      httpStatus,
      location,
      latencyMs,
      timedOut: false,
      warnings,
    };
  } catch (err) {
    return {
      route,
      url,
      status: "fail",
      httpStatus: null,
      location: null,
      latencyMs: typeof err?.latencyMs === "number" ? err.latencyMs : null,
      timedOut: Boolean(err?.timedOut),
      error: err instanceof Error ? err.message : String(err),
      warnings,
    };
  }
}

/**
 * Pure verdict evaluator for RPC + web route probe results.
 * Returns `healthy`, `degraded`, or `failed` plus process exitCode.
 */
export function evaluateVerdict({ rpc, routes, strict = false }) {
  const failures = [];
  const warnings = [];

  if (rpc.status === "fail") {
    failures.push(`RPC ${rpc.url}: ${rpc.error ?? "failed"}`);
  } else if (rpc.status === "degraded") {
    warnings.push(...(rpc.warnings ?? [`RPC ${rpc.url}: degraded`]));
  }

  for (const r of routes) {
    if (r.status === "fail") {
      failures.push(`Route ${r.route}: ${r.error ?? "failed"}`);
    } else if (r.status === "degraded") {
      warnings.push(...(r.warnings ?? [`Route ${r.route}: degraded`]));
    }
  }

  if (failures.length > 0) {
    return {
      verdict: "failed",
      healthy: false,
      exitCode: 1,
      failures,
      warnings,
    };
  }

  if (warnings.length > 0) {
    return {
      verdict: "degraded",
      healthy: !strict,
      exitCode: strict ? 1 : 0,
      failures,
      warnings,
    };
  }

  return {
    verdict: "healthy",
    healthy: true,
    exitCode: 0,
    failures,
    warnings,
  };
}

export async function runSyntheticProbe(options = {}) {
  const opts = {
    rpcUrl: options.rpcUrl ?? DEFAULT_RPC_URL,
    webBaseUrl: options.webBaseUrl ?? DEFAULT_WEB_BASE_URL,
    routes: options.routes ?? DEFAULT_ROUTES,
    expectedChainId: options.expectedChainId ?? DEFAULT_EXPECTED_CHAIN_ID,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    latencyWarnMs: options.latencyWarnMs ?? DEFAULT_LATENCY_WARN_MS,
    strict: Boolean(options.strict),
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  };

  const startedAt = new Date().toISOString();
  const [rpc, routes] = await Promise.all([
    probeRpc({
      rpcUrl: opts.rpcUrl,
      expectedChainId: opts.expectedChainId,
      timeoutMs: opts.timeoutMs,
      latencyWarnMs: opts.latencyWarnMs,
      fetchImpl: opts.fetchImpl,
    }),
    Promise.all(
      opts.routes.map((route) =>
        probeRoute({
          baseUrl: opts.webBaseUrl,
          route,
          timeoutMs: opts.timeoutMs,
          latencyWarnMs: opts.latencyWarnMs,
          fetchImpl: opts.fetchImpl,
        }),
      ),
    ),
  ]);

  const summary = evaluateVerdict({ rpc, routes, strict: opts.strict });

  return {
    timestamp: startedAt,
    verdict: summary.verdict,
    healthy: summary.healthy,
    exitCode: summary.exitCode,
    rpc,
    routes,
    warnings: summary.warnings,
    failures: summary.failures,
  };
}

export function formatHumanReport(report) {
  const lines = [
    `Kovanica Synthetic Health Probe (${report.timestamp})`,
    `Verdict: ${report.verdict.toUpperCase()}`,
    `RPC: [${report.rpc.status.toUpperCase()}] ${report.rpc.url} chainId=${report.rpc.chainId ?? "n/a"} block=${report.rpc.blockNumber ?? "n/a"} latency=${report.rpc.latencyMs ?? "n/a"}ms${report.rpc.error ? ` (${report.rpc.error})` : ""}`,
  ];
  for (const r of report.routes) {
    const redir = r.location ? ` -> ${r.location}` : "";
    lines.push(
      `Route ${r.route}: [${r.status.toUpperCase()}] HTTP ${r.httpStatus ?? "ERR"}${redir} latency=${r.latencyMs ?? "n/a"}ms${r.error ? ` (${r.error})` : ""}`,
    );
  }
  if (report.warnings.length > 0) {
    lines.push(`Warnings (${report.warnings.length}):`);
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  if (report.failures.length > 0) {
    lines.push(`Failures (${report.failures.length}):`);
    for (const f of report.failures) lines.push(`  - ${f}`);
  }
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = await runSyntheticProbe(opts);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatHumanReport(report)}\n`);
  }
  process.exitCode = report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
