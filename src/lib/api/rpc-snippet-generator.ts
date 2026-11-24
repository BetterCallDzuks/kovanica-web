/**
 * Pure catalog, search/category filter, and shell-safe `curl` / `kovanica-sdk` (v0.7.0)
 * snippet generator for Kovanica JSON-RPC 2.0 & HTTP health endpoints.
 */

import { DEFAULT_TESTNET_RPC_URL } from "./rpc-spec";

export const KOVANICA_SDK_VERSION = "0.7.0";

export const RPC_METHOD_CATEGORIES = [
  "Chain",
  "Accounts",
  "Contracts",
  "Mempool",
  "Health",
] as const;

export type RpcMethodCategory = (typeof RPC_METHOD_CATEGORIES)[number];

export type RpcMethodFilterCategory = "All" | RpcMethodCategory;

export type RpcMethodParamSpec = {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
  readonly example: string;
};

export type RpcMethodCatalogEntry = {
  readonly id: string;
  readonly method: string;
  readonly transport: "json-rpc" | "http-get";
  readonly httpPath?: string;
  readonly category: RpcMethodCategory;
  readonly summary: string;
  readonly description: string;
  readonly returns: string;
  readonly sdkHelper: string;
  readonly params: readonly RpcMethodParamSpec[];
  readonly exampleParams: readonly unknown[];
};

const SAMPLE_ADDRESS =
  "kvncqpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khcdag";
const SAMPLE_CONTRACT =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const SAMPLE_SLOT =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const SAMPLE_CALLDATA = "0x01000000";

export const RPC_METHOD_CATALOG: readonly RpcMethodCatalogEntry[] = [
  {
    id: "kovanica_blockNumber",
    method: "kovanica_blockNumber",
    transport: "json-rpc",
    category: "Chain",
    summary: "Latest committed leader block height",
    description:
      "Returns the latest committed GHOSTDAG leader height as a hex-encoded quantity.",
    returns: "HexQuantity (e.g. \"0x1a2b\")",
    sdkHelper: "client.blockNumber()",
    params: [],
    exampleParams: [],
  },
  {
    id: "kovanica_getBlockByHeight",
    method: "kovanica_getBlockByHeight",
    transport: "json-rpc",
    category: "Chain",
    summary: "Fetch block header and transactions by height",
    description:
      "Returns the committed block at a given height, optionally expanding full transaction objects.",
    returns: "BlockResponse | null",
    sdkHelper: "client.getBlockByHeight()",
    params: [
      {
        name: "height",
        type: "HexQuantity | number",
        required: true,
        description: "Committed leader height (decimal or 0x-prefixed hex quantity).",
        example: "\"0x64\"",
      },
      {
        name: "fullTransactions",
        type: "boolean",
        required: false,
        description: "When true, returns full transaction objects instead of tx hashes.",
        example: "false",
      },
    ],
    exampleParams: ["0x64", false],
  },
  {
    id: "kovanica_getBalance",
    method: "kovanica_getBalance",
    transport: "json-rpc",
    category: "Accounts",
    summary: "Account KVNC balance in atomic units",
    description:
      "Returns the spendable balance of a canonical kvnc…dag address in atoms (1 KVNC = 10^9 atoms).",
    returns: "HexQuantity (atoms)",
    sdkHelper: "client.getBalance()",
    params: [
      {
        name: "address",
        type: "KovanicaAddress",
        required: true,
        description: "Canonical 64-character kvnc…dag address.",
        example: SAMPLE_ADDRESS,
      },
    ],
    exampleParams: [SAMPLE_ADDRESS],
  },
  {
    id: "kovanica_getTransactionHistory",
    method: "kovanica_getTransactionHistory",
    transport: "json-rpc",
    category: "Accounts",
    summary: "Paginated account transaction history",
    description:
      "Returns cursor-paginated inbound and outbound transactions for an account with lossless atomic amounts.",
    returns: "{ entries: AccountTxHistoryEntry[], next_cursor: string | null }",
    sdkHelper: "getAccountTxHistory()",
    params: [
      {
        name: "address",
        type: "KovanicaAddress",
        required: true,
        description: "Canonical account address to query.",
        example: SAMPLE_ADDRESS,
      },
      {
        name: "limit",
        type: "number",
        required: false,
        description: "Page size (default 25, max 100).",
        example: "25",
      },
      {
        name: "cursor",
        type: "string | null",
        required: false,
        description: "Opaque pagination cursor returned by the previous page.",
        example: "null",
      },
    ],
    exampleParams: [{ address: SAMPLE_ADDRESS, limit: 25 }],
  },
  {
    id: "kovanica_getLogs",
    method: "kovanica_getLogs",
    transport: "json-rpc",
    category: "Contracts",
    summary: "Query contract event logs with block range & cursor",
    description:
      "Retrieves contract execution logs filtered by contract address and block height range, supporting pagination.",
    returns: "{ logs: ContractLogEntry[], next_cursor?: string | null }",
    sdkHelper: "queryContractLogsPaginated()",
    params: [
      {
        name: "address",
        type: "HexString | KovanicaAddress",
        required: false,
        description: "Contract address filter.",
        example: SAMPLE_CONTRACT,
      },
      {
        name: "fromHeight",
        type: "number | HexQuantity",
        required: false,
        description: "Inclusive start block height.",
        example: "0",
      },
      {
        name: "toHeight",
        type: "number | HexQuantity",
        required: false,
        description: "Inclusive end block height.",
        example: "1000",
      },
      {
        name: "limit",
        type: "number",
        required: false,
        description: "Maximum logs per page.",
        example: "50",
      },
    ],
    exampleParams: [
      {
        address: SAMPLE_CONTRACT,
        fromHeight: 0,
        toHeight: 1000,
        limit: 50,
      },
    ],
  },
  {
    id: "kovanica_getStorageAt",
    method: "kovanica_getStorageAt",
    transport: "json-rpc",
    category: "Contracts",
    summary: "Read raw 32-byte contract storage slot",
    description:
      "Reads a contract's persistent storage slot by 32-byte hex key for Bincode state inspection.",
    returns: "HexString (raw slot bytes)",
    sdkHelper: "readContractStorage()",
    params: [
      {
        name: "address",
        type: "HexString | KovanicaAddress",
        required: true,
        description: "Target contract address.",
        example: SAMPLE_CONTRACT,
      },
      {
        name: "slot",
        type: "HexString",
        required: true,
        description: "32-byte storage slot key (0x-prefixed hex).",
        example: SAMPLE_SLOT,
      },
    ],
    exampleParams: [SAMPLE_CONTRACT, SAMPLE_SLOT],
  },
  {
    id: "kovanica_call",
    method: "kovanica_call",
    transport: "json-rpc",
    category: "Contracts",
    summary: "Stateless read-only Wasm contract dry-run",
    description:
      "Simulates a contract call against current state without mutating the chain or spending gas.",
    returns: "{ return_data: HexString, gas_used: number, logs: ContractLogEntry[] }",
    sdkHelper: "dryRunCall()",
    params: [
      {
        name: "to",
        type: "HexString | KovanicaAddress",
        required: true,
        description: "Target contract address.",
        example: SAMPLE_CONTRACT,
      },
      {
        name: "data",
        type: "HexString",
        required: true,
        description: "Bincode-encoded call payload (0x-prefixed hex).",
        example: SAMPLE_CALLDATA,
      },
      {
        name: "from",
        type: "KovanicaAddress",
        required: false,
        description: "Optional simulated caller address.",
        example: SAMPLE_ADDRESS,
      },
    ],
    exampleParams: [
      {
        to: SAMPLE_CONTRACT,
        data: SAMPLE_CALLDATA,
        from: SAMPLE_ADDRESS,
      },
    ],
  },
  {
    id: "kovanica_mempoolStats",
    method: "kovanica_mempoolStats",
    transport: "json-rpc",
    category: "Mempool",
    summary: "Live mempool depth and fee-rate percentiles",
    description:
      "Returns pending transaction count, total serialized bytes, and min/p50/p90/max fee rates in atoms/byte.",
    returns: "MempoolFeeStats",
    sdkHelper: "estimatePriorityFeeTiers()",
    params: [],
    exampleParams: [],
  },
  {
    id: "GET /health",
    method: "GET /health",
    transport: "http-get",
    httpPath: "/health",
    category: "Health",
    summary: "Node HTTP liveness and chain identity headers",
    description:
      "Lightweight HTTP liveness probe returning node sync status alongside X-Kovanica-Chain-Id, X-Kovanica-Network-Tag, and X-Kovanica-Rpc-Version headers.",
    returns: "200 OK JSON + X-Kovanica-* headers",
    sdkHelper: "probeRpcNode()",
    params: [],
    exampleParams: [],
  },
] as const;

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
 * Validates and sanitizes an RPC endpoint URL for safe inclusion in shell and SDK snippets.
 * Rejects empty strings, control characters, whitespace, shell metacharacters, and non-HTTP(S) schemes.
 */
export function validateRpcSnippetUrl(rpcUrl: string): string {
  if (typeof rpcUrl !== "string") {
    throw new Error("RPC URL must be a string.");
  }

  if (hasControlChar(rpcUrl)) {
    throw new Error("RPC URL contains disallowed control characters.");
  }

  const trimmed = rpcUrl.trim();
  if (!trimmed) {
    throw new Error("RPC URL must not be empty.");
  }

  if (SHELL_UNSAFE_RE.test(trimmed)) {
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

  return trimmed;
}

/**
 * POSIX single-quote wrapper that safely escapes any embedded single quotes.
 */
export function quotePosixShellArg(value: string): string {
  if (hasControlChar(value)) {
    throw new Error("Shell argument contains disallowed control characters.");
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Derives the `/health` URL from a validated RPC URL (replacing a trailing `/rpc` segment).
 */
export function deriveHealthUrl(rpcUrl: string): string {
  const safeUrl = validateRpcSnippetUrl(rpcUrl);
  const parsed = new URL(safeUrl);
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");

  if (normalizedPath.endsWith("/health")) {
    parsed.pathname = normalizedPath;
  } else if (normalizedPath.endsWith("/rpc")) {
    parsed.pathname = `${normalizedPath.slice(0, -4)}/health`;
  } else {
    parsed.pathname = `${normalizedPath}/health`;
  }

  return parsed.toString();
}

/**
 * Filters the RPC method catalog by optional category and case-insensitive search query.
 */
export function filterRpcMethods(
  query: string,
  category: RpcMethodFilterCategory = "All",
  catalog: readonly RpcMethodCatalogEntry[] = RPC_METHOD_CATALOG,
): readonly RpcMethodCatalogEntry[] {
  const normalizedQuery = query.trim().toLowerCase();

  return catalog.filter((entry) => {
    if (category !== "All" && entry.category !== category) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      entry.method,
      entry.category,
      entry.summary,
      entry.description,
      entry.sdkHelper,
      ...entry.params.map((param) => `${param.name} ${param.description}`),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

/**
 * Looks up a catalog entry by its id or method name.
 */
export function getRpcMethodById(
  methodId: string,
  catalog: readonly RpcMethodCatalogEntry[] = RPC_METHOD_CATALOG,
): RpcMethodCatalogEntry | undefined {
  return catalog.find((entry) => entry.id === methodId || entry.method === methodId);
}

/**
 * Builds a POSIX single-quoted, shell-safe `curl` snippet for the given RPC method entry.
 */
export function buildCurlSnippet(
  entry: RpcMethodCatalogEntry,
  rpcUrl: string = DEFAULT_TESTNET_RPC_URL,
): string {
  const safeUrl = validateRpcSnippetUrl(rpcUrl);

  if (entry.transport === "http-get") {
    const healthUrl = deriveHealthUrl(safeUrl);
    return `curl -i -sS -X GET ${quotePosixShellArg(healthUrl)}`;
  }

  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: entry.method,
    params: entry.exampleParams,
  });

  return [
    `curl -sS -X POST ${quotePosixShellArg(safeUrl)} \\`,
    "  -H 'Content-Type: application/json' \\",
    `  -d ${quotePosixShellArg(payload)}`,
  ].join("\n");
}

/**
 * Builds a `kovanica-sdk` (v0.7.0) TypeScript snippet for the given RPC method entry.
 */
export function buildSdkSnippet(
  entry: RpcMethodCatalogEntry,
  rpcUrl: string = DEFAULT_TESTNET_RPC_URL,
): string {
  const safeUrl = validateRpcSnippetUrl(rpcUrl);
  const urlLiteral = JSON.stringify(safeUrl);

  switch (entry.id) {
    case "kovanica_blockNumber":
      return [
        `// kovanica-sdk v${KOVANICA_SDK_VERSION}`,
        'import { KovanicaClient } from "kovanica-sdk";',
        "",
        `const client = new KovanicaClient({ url: ${urlLiteral} });`,
        "const height = await client.blockNumber();",
        'console.log("Latest leader height:", height.toString());',
      ].join("\n");

    case "kovanica_getBlockByHeight":
      return [
        `// kovanica-sdk v${KOVANICA_SDK_VERSION}`,
        'import { KovanicaClient } from "kovanica-sdk";',
        "",
        `const client = new KovanicaClient({ url: ${urlLiteral} });`,
        "const block = await client.getBlockByHeight(100n, false);",
        'console.log("Block hash:", block?.hash, "txs:", block?.transactions.length);',
      ].join("\n");

    case "kovanica_getBalance":
      return [
        `// kovanica-sdk v${KOVANICA_SDK_VERSION}`,
        'import { KovanicaClient, formatKvnc } from "kovanica-sdk";',
        "",
        `const client = new KovanicaClient({ url: ${urlLiteral} });`,
        `const balanceAtoms = await client.getBalance(${JSON.stringify(SAMPLE_ADDRESS)});`,
        'console.log("Balance:", formatKvnc(balanceAtoms), "KVNC");',
      ].join("\n");

    case "kovanica_getTransactionHistory":
      return [
        `// kovanica-sdk v${KOVANICA_SDK_VERSION}`,
        'import { KovanicaClient, getAccountTxHistory } from "kovanica-sdk";',
        "",
        `const client = new KovanicaClient({ url: ${urlLiteral} });`,
        "const history = await getAccountTxHistory(client, {",
        `  address: ${JSON.stringify(SAMPLE_ADDRESS)},`,
        "  limit: 25,",
        "  maxPages: 2,",
        "});",
        'console.log("Fetched transactions:", history.entries.length);',
      ].join("\n");

    case "kovanica_getLogs":
      return [
        `// kovanica-sdk v${KOVANICA_SDK_VERSION}`,
        'import { KovanicaClient, queryContractLogsPaginated } from "kovanica-sdk";',
        "",
        `const client = new KovanicaClient({ url: ${urlLiteral} });`,
        "const result = await queryContractLogsPaginated(",
        "  client,",
        "  {",
        `    address: ${JSON.stringify(SAMPLE_CONTRACT)},`,
        "    fromHeight: 0n,",
        "    toHeight: 1000n,",
        "  },",
        "  { limit: 50, maxPages: 3 },",
        ");",
        'console.log("Logs:", result.logs.length, "nextCursor:", result.nextCursor);',
      ].join("\n");

    case "kovanica_getStorageAt":
      return [
        `// kovanica-sdk v${KOVANICA_SDK_VERSION}`,
        'import { KovanicaClient, readContractStorage } from "kovanica-sdk";',
        "",
        `const client = new KovanicaClient({ url: ${urlLiteral} });`,
        "const slot = await readContractStorage(",
        "  client,",
        `  ${JSON.stringify(SAMPLE_CONTRACT)},`,
        `  { slotHex: ${JSON.stringify(SAMPLE_SLOT)} },`,
        ");",
        'console.log("Slot exists:", slot.exists, "raw hex:", slot.rawHex);',
      ].join("\n");

    case "kovanica_call":
      return [
        `// kovanica-sdk v${KOVANICA_SDK_VERSION}`,
        'import { KovanicaClient, dryRunCall } from "kovanica-sdk";',
        "",
        `const client = new KovanicaClient({ url: ${urlLiteral} });`,
        "const simulation = await dryRunCall(client, {",
        `  to: ${JSON.stringify(SAMPLE_CONTRACT)},`,
        `  data: ${JSON.stringify(SAMPLE_CALLDATA)},`,
        `  from: ${JSON.stringify(SAMPLE_ADDRESS)},`,
        "});",
        'console.log("Gas used:", simulation.gasUsed, "returnData:", simulation.returnData);',
      ].join("\n");

    case "kovanica_mempoolStats":
      return [
        `// kovanica-sdk v${KOVANICA_SDK_VERSION}`,
        'import { KovanicaClient, estimatePriorityFeeTiers } from "kovanica-sdk";',
        "",
        `const client = new KovanicaClient({ url: ${urlLiteral} });`,
        "const estimate = await estimatePriorityFeeTiers(client, { txSizeBytes: 256 });",
        'console.log("Congestion:", estimate.congestion, "standard fee:", estimate.tiers.standard.totalFeeAtoms);',
      ].join("\n");

    case "GET /health":
      return [
        `// kovanica-sdk v${KOVANICA_SDK_VERSION}`,
        'import { probeRpcNode } from "kovanica-sdk";',
        "",
        `const probe = await probeRpcNode(${urlLiteral});`,
        'console.log("Healthy:", probe.ok, "networkTag:", probe.networkTag, "latencyMs:", probe.latencyMs);',
      ].join("\n");

    default:
      return [
        `// kovanica-sdk v${KOVANICA_SDK_VERSION}`,
        'import { KovanicaClient } from "kovanica-sdk";',
        "",
        `const client = new KovanicaClient({ url: ${urlLiteral} });`,
        `const result = await client.call(${JSON.stringify(entry.method)}, ${JSON.stringify(entry.exampleParams)});`,
        "console.log(result);",
      ].join("\n");
  }
}
