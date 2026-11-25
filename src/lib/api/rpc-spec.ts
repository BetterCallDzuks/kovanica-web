/**
 * Canonical JSON-RPC 2.0 identity header and `kovanica_mempoolStats` quick-reference
 * specification shared by `/api-reference` and unit tests.
 */

export type RpcIdentityHeader = {
  readonly name: string;
  readonly description: string;
  readonly example: string;
};

export type RpcMethodField = {
  readonly name: string;
  readonly type: string;
  readonly description: string;
};

export type RpcMethodSpec = {
  readonly method: "kovanica_mempoolStats";
  readonly description: string;
  readonly params: string;
  readonly emptyBehavior: string;
  readonly fields: readonly RpcMethodField[];
};

export const DEFAULT_TESTNET_RPC_URL = "https://rpc-testnet.kovanica.online/rpc";

/**
 * HTTP response headers attached to `/rpc` and `/health` and exposed via
 * `Access-Control-Expose-Headers` so clients can verify chain identity.
 */
export const RPC_IDENTITY_HEADERS: readonly RpcIdentityHeader[] = [
  {
    name: "X-Kovanica-Chain-Id",
    description: "Decimal chain ID (1 Mainnet, 2 Testnet, 3 Devnet).",
    example: "2",
  },
  {
    name: "X-Kovanica-Network-Tag",
    description:
      "Canonical network tag (1-f35df34c92001436 for Chain 1, 2-24cdb5fadd98b207 for Chain 2).",
    example: "2-24cdb5fadd98b207",
  },
  {
    name: "X-Kovanica-Rpc-Version",
    description: "Semantic version of the kovanica-rpc server crate.",
    example: "1.0.0",
  },
] as const;

/**
 * Read-only mempool fee-percentile snapshot method metadata.
 */
export const RPC_MEMPOOL_STATS_METHOD: RpcMethodSpec = {
  method: "kovanica_mempoolStats",
  description:
    "Read-only fee-percentile snapshot of the local mempool. Supported in both single POST /rpc and JSON-RPC 2.0 batch requests.",
  params: "[] (empty array or omitted)",
  emptyBehavior:
    "When pending_count is 0, min_fee_per_byte, p50_fee_per_byte, p90_fee_per_byte, and max_fee_per_byte return null.",
  fields: [
    {
      name: "pending_count",
      type: "number",
      description: "Total pending transactions currently held in the mempool.",
    },
    {
      name: "total_bytes",
      type: "number",
      description: "Aggregate serialized byte size of all pending mempool transactions.",
    },
    {
      name: "min_fee_per_byte",
      type: "number | null",
      description: "Lowest fee rate in atoms/byte among pending transactions (null if empty).",
    },
    {
      name: "p50_fee_per_byte",
      type: "number | null",
      description: "Median (50th percentile) fee rate in atoms/byte (null if empty).",
    },
    {
      name: "p90_fee_per_byte",
      type: "number | null",
      description: "90th percentile fee rate in atoms/byte for priority inclusion (null if empty).",
    },
    {
      name: "max_fee_per_byte",
      type: "number | null",
      description: "Highest fee rate in atoms/byte among pending transactions (null if empty).",
    },
  ],
} as const;

const SHELL_UNSAFE_RE = /[\s'"\\`$;&|<>()*?[\]{}~!#]/;

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Builds a shell-safe single-POST JSON-RPC 2.0 batch `curl -i` command querying
 * `kovanica_chainId`, `kovanica_blockNumber`, and `kovanica_mempoolStats`.
 *
 * Rejects non-HTTP(S) URLs and any shell metacharacters or control characters.
 */
export function buildRpcBatchCurlExample(rpcUrl: string): string {
  if (typeof rpcUrl !== "string") {
    throw new Error("RPC URL must be a string.");
  }

  const trimmed = rpcUrl.trim();
  if (!trimmed) {
    throw new Error("RPC URL must not be empty.");
  }

  if (SHELL_UNSAFE_RE.test(trimmed) || hasControlChar(trimmed)) {
    throw new Error("RPC URL contains disallowed shell metacharacters or whitespace.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("RPC URL is not a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("RPC URL must use the http:// or https:// scheme.");
  }

  const batchPayload = JSON.stringify([
    { jsonrpc: "2.0", id: 1, method: "kovanica_chainId", params: [] },
    { jsonrpc: "2.0", id: 2, method: "kovanica_blockNumber", params: [] },
    { jsonrpc: "2.0", id: 3, method: "kovanica_mempoolStats", params: [] },
  ]);

  return [
    `curl -i -sS -X POST '${trimmed}' \\`,
    "  -H 'Content-Type: application/json' \\",
    `  -d '${batchPayload}'`,
  ].join("\n");
}
