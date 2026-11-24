/**
 * Pure, dependency-free Kovanica CLI Cheat-Sheet command builders & validators.
 *
 * Generates safe, shell-escaped `kovanica` CLI commands matching
 * `kovanica-l1/crates/kovanica-cli` exact subcommands, flags, and canonical
 * chain IDs (`1` mainnet, `2` testnet, `3` devnet) while rejecting control
 * characters and shell injection payloads.
 */

export type CliNetwork = "testnet" | "mainnet" | "devnet";

export type CliCommandId =
  | "node-doctor"
  | "rpc-probe"
  | "snapshot-verify"
  | "tx-decode"
  | "tx-envelope"
  | "key-inspect";

export type TxEnvelopeMode = "encode" | "decode";
export type AirgapTxKind = "transfer" | "call" | "raw";

export interface CliNetworkSpec {
  readonly network: CliNetwork;
  readonly label: string;
  readonly shortLabel: string;
  readonly chainId: 1 | 2 | 3;
  readonly networkTag: string | null;
  readonly defaultRpcUrl: string;
  readonly defaultStratumHealthUrl: string;
  readonly defaultSnapshotPath: string;
}

export const CLI_NETWORK_SPECS: Record<CliNetwork, CliNetworkSpec> = {
  testnet: {
    network: "testnet",
    label: "Testnet (Chain 2)",
    shortLabel: "Testnet",
    chainId: 2,
    networkTag: "2-24cdb5fadd98b207",
    defaultRpcUrl: "https://rpc-testnet.kovanica.online",
    defaultStratumHealthUrl: "http://127.0.0.1:9100/health",
    defaultSnapshotPath: "./snapshots/testnet/manifest.json",
  },
  mainnet: {
    network: "mainnet",
    label: "Mainnet (Chain 1)",
    shortLabel: "Mainnet",
    chainId: 1,
    networkTag: "1-f35df34c92001436",
    defaultRpcUrl: "http://127.0.0.1:8545",
    defaultStratumHealthUrl: "http://127.0.0.1:9100/health",
    defaultSnapshotPath: "./snapshots/mainnet/manifest.json",
  },
  devnet: {
    network: "devnet",
    label: "Devnet (Chain 3)",
    shortLabel: "Devnet",
    chainId: 3,
    networkTag: null,
    defaultRpcUrl: "http://127.0.0.1:8545",
    defaultStratumHealthUrl: "http://127.0.0.1:9100/health",
    defaultSnapshotPath: "./snapshots/devnet/manifest.json",
  },
};

export interface CliCommandMeta {
  readonly id: CliCommandId;
  readonly label: string;
  readonly subcommand: string;
  readonly mode: "Live RPC" | "Offline";
  readonly summary: string;
}

export const CLI_COMMANDS: readonly CliCommandMeta[] = [
  {
    id: "node-doctor",
    label: "node doctor",
    subcommand: "kovanica node doctor",
    mode: "Live RPC",
    summary:
      "Run read-only pre-flight diagnostics against a node (RPC reachability, canonical network tag, batch support, sync/peers, optional Stratum health).",
  },
  {
    id: "rpc-probe",
    label: "rpc probe",
    subcommand: "kovanica rpc probe",
    mode: "Live RPC",
    summary:
      "Single-shot JSON-RPC 2.0 batch probe verifying latency, X-Kovanica-* identity headers, chain ID, and canonical network tag.",
  },
  {
    id: "snapshot-verify",
    label: "snapshot verify",
    subcommand: "kovanica snapshot verify",
    mode: "Offline",
    summary:
      "Verify snapshot manifest schema, streaming BLAKE3 payload hashes, chain ID, and frozen network tag completely offline.",
  },
  {
    id: "tx-decode",
    label: "tx decode",
    subcommand: "kovanica tx decode",
    mode: "Offline",
    summary:
      "Decode a raw Bincode-encoded transaction hex payload offline and verify its Ed25519 signature against the canonical sighash.",
  },
  {
    id: "tx-envelope",
    label: "tx envelope",
    subcommand: "kovanica tx envelope",
    mode: "Offline",
    summary:
      "Encode or decode air-gapped transaction envelopes (kvnc-tx:v1:<base64url>) with BLAKE3 integrity and network-tag pinning.",
  },
  {
    id: "key-inspect",
    label: "key inspect",
    subcommand: "kovanica key inspect",
    mode: "Offline",
    summary:
      "Audit a keystore v2 JSON file offline (Argon2id KDF parameters, PRO-21 addresses, and 0600 permissions) without decrypting secrets.",
  },
] as const;

export const DEFAULT_RPC_PROBE_TIMEOUT_SECS = 10;
export const MAX_RPC_PROBE_TIMEOUT_SECS = 300;

export const EXAMPLE_RAW_TX_HEX =
  "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
export const EXAMPLE_AIRGAP_ENVELOPE =
  "kvnc-tx:v1:eyJ2ZXJzaW9uIjoxLCJjaGFpbklkIjoyfQ";
export const EXAMPLE_KEYFILE_PATH = "./keystore.json";

export interface NodeDoctorOptions {
  network: CliNetwork;
  rpcUrl: string;
  stratumHealthUrl?: string;
  includeExpectedChainId?: boolean;
  json?: boolean;
}

export interface RpcProbeOptions {
  network: CliNetwork;
  rpcUrl: string;
  timeoutSecs?: number;
  includeExpectedChainId?: boolean;
  json?: boolean;
}

export interface SnapshotVerifyOptions {
  network: CliNetwork;
  snapshotPath: string;
  includeExpectedChainId?: boolean;
  json?: boolean;
}

export interface TxDecodeOptions {
  network: CliNetwork;
  rawTxHex: string;
  includeChainId?: boolean;
  json?: boolean;
}

export interface TxEnvelopeOptions {
  network: CliNetwork;
  mode: TxEnvelopeMode;
  rawTxHex?: string;
  kind?: AirgapTxKind;
  signingHash?: string;
  envelope?: string;
  includeExpectedChainId?: boolean;
  json?: boolean;
}

export interface KeyInspectOptions {
  keyfilePath: string;
  json?: boolean;
}

export type CliCommandRequest =
  | ({ command: "node-doctor" } & NodeDoctorOptions)
  | ({ command: "rpc-probe" } & RpcProbeOptions)
  | ({ command: "snapshot-verify" } & SnapshotVerifyOptions)
  | ({ command: "tx-decode" } & TxDecodeOptions)
  | ({ command: "tx-envelope" } & TxEnvelopeOptions)
  | ({ command: "key-inspect" } & KeyInspectOptions);

export type CliCommandResult =
  | {
      ok: true;
      command: string;
      args: string[];
      chainId: 1 | 2 | 3 | null;
      networkTag: string | null;
    }
  | {
      ok: false;
      error: string;
    };

/** Any ASCII control character (NUL..US, DEL). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

/** Shell metacharacters that can split commands, spawn subshells, or redirect I/O. */
const SHELL_INJECTION_RE = /[;|&`$()<>\\*?[\]!~#]/;

/** Strict URL metacharacter check (disallows whitespace, quotes, and shell operators). */
const URL_DISALLOWED_RE = /[\s'";|&`$()<>\\*?[\]!~#]/;

/** Safe unquoted POSIX shell token. */
const SAFE_UNQUOTED_TOKEN_RE = /^[A-Za-z0-9._:/+-]+$/;

/** Bare hex string (even length checked separately). */
const HEX_BODY_RE = /^[0-9a-fA-F]+$/;

/** Compact air-gap envelope format (`kvnc-tx:v1:<base64url>`). */
const AIRGAP_ENVELOPE_RE = /^kvnc-tx:v1:[A-Za-z0-9_-]{4,}$/;

export function containsControlChars(value: string): boolean {
  return CONTROL_CHAR_RE.test(value);
}

export function containsShellInjection(value: string): boolean {
  return CONTROL_CHAR_RE.test(value) || SHELL_INJECTION_RE.test(value);
}

/**
 * Shell-escape a validated CLI argument using POSIX single quotes when needed.
 */
export function shellQuote(value: string): string {
  if (SAFE_UNQUOTED_TOKEN_RE.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatCommand(args: string[]): string {
  return ["kovanica", ...args.map(shellQuote)].join(" ");
}

function validateHttpUrl(
  raw: string,
  fieldLabel: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: `${fieldLabel} is required.` };
  }
  if (containsControlChars(trimmed) || URL_DISALLOWED_RE.test(trimmed)) {
    return {
      ok: false,
      error: `${fieldLabel} contains disallowed control characters, whitespace, or shell metacharacters.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: `${fieldLabel} must be a valid http:// or https:// URL.`,
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: `${fieldLabel} must use http:// or https://.`,
    };
  }
  if (!parsed.hostname) {
    return {
      ok: false,
      error: `${fieldLabel} must include a hostname.`,
    };
  }

  return { ok: true, value: trimmed };
}

function validateFilePath(
  raw: string,
  fieldLabel: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: `${fieldLabel} is required.` };
  }
  if (containsShellInjection(trimmed) || trimmed.includes('"') || trimmed.includes("'")) {
    return {
      ok: false,
      error: `${fieldLabel} contains disallowed control characters or shell metacharacters.`,
    };
  }
  if (trimmed.length > 512) {
    return {
      ok: false,
      error: `${fieldLabel} must be 512 characters or fewer.`,
    };
  }
  return { ok: true, value: trimmed };
}

function validateHexPayload(
  raw: string,
  fieldLabel: string,
  exactBytes?: number,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: `${fieldLabel} is required.` };
  }
  if (containsControlChars(trimmed) || /\s/.test(trimmed) || SHELL_INJECTION_RE.test(trimmed)) {
    return {
      ok: false,
      error: `${fieldLabel} contains disallowed control characters, whitespace, or shell metacharacters.`,
    };
  }

  const hasPrefix = trimmed.startsWith("0x") || trimmed.startsWith("0X");
  const body = hasPrefix ? trimmed.slice(2) : trimmed;

  if (!body || !HEX_BODY_RE.test(body)) {
    return {
      ok: false,
      error: `${fieldLabel} must be valid hexadecimal (optional 0x prefix).`,
    };
  }
  if (body.length % 2 !== 0) {
    return {
      ok: false,
      error: `${fieldLabel} must have an even number of hex characters.`,
    };
  }
  if (exactBytes !== undefined && body.length !== exactBytes * 2) {
    return {
      ok: false,
      error: `${fieldLabel} must be exactly ${exactBytes} bytes (${exactBytes * 2} hex characters).`,
    };
  }

  return { ok: true, value: hasPrefix ? `0x${body.toLowerCase()}` : body.toLowerCase() };
}

function validateAirgapEnvelope(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Air-gap envelope payload is required." };
  }
  if (containsShellInjection(trimmed)) {
    return {
      ok: false,
      error: "Air-gap envelope contains disallowed control characters or shell metacharacters.",
    };
  }

  if (AIRGAP_ENVELOPE_RE.test(trimmed)) {
    return { ok: true, value: trimmed };
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ok: true, value: trimmed };
      }
    } catch {
      // Fall through to structured error
    }
    return {
      ok: false,
      error: "Raw JSON envelope must be a valid JSON object.",
    };
  }

  return {
    ok: false,
    error: "Envelope must be a kvnc-tx:v1:<base64url> string or a raw JSON object.",
  };
}

export function buildNodeDoctorCommand(options: NodeDoctorOptions): CliCommandResult {
  const spec = CLI_NETWORK_SPECS[options.network];
  const rpcCheck = validateHttpUrl(options.rpcUrl, "RPC URL");
  if (!rpcCheck.ok) return rpcCheck;

  const args: string[] = ["node", "doctor", "--rpc-url", rpcCheck.value];

  if (options.includeExpectedChainId ?? true) {
    args.push("--expected-chain-id", String(spec.chainId));
  }

  const stratumRaw = options.stratumHealthUrl?.trim() ?? "";
  if (stratumRaw) {
    const stratumCheck = validateHttpUrl(stratumRaw, "Stratum health URL");
    if (!stratumCheck.ok) return stratumCheck;
    args.push("--stratum-health-url", stratumCheck.value);
  }

  if (options.json) {
    args.push("--json");
  }

  return {
    ok: true,
    command: formatCommand(args),
    args,
    chainId: spec.chainId,
    networkTag: spec.networkTag,
  };
}

export function buildRpcProbeCommand(options: RpcProbeOptions): CliCommandResult {
  const spec = CLI_NETWORK_SPECS[options.network];
  const rpcCheck = validateHttpUrl(options.rpcUrl, "RPC URL");
  if (!rpcCheck.ok) return rpcCheck;

  const args: string[] = ["rpc", "probe", rpcCheck.value];

  if (options.includeExpectedChainId ?? true) {
    args.push("--expected-chain-id", String(spec.chainId));
  }

  if (options.timeoutSecs !== undefined) {
    if (
      !Number.isInteger(options.timeoutSecs) ||
      options.timeoutSecs < 1 ||
      options.timeoutSecs > MAX_RPC_PROBE_TIMEOUT_SECS
    ) {
      return {
        ok: false,
        error: `Timeout must be a whole number between 1 and ${MAX_RPC_PROBE_TIMEOUT_SECS} seconds.`,
      };
    }
    if (options.timeoutSecs !== DEFAULT_RPC_PROBE_TIMEOUT_SECS) {
      args.push("--timeout-secs", String(options.timeoutSecs));
    }
  }

  if (options.json) {
    args.push("--json");
  }

  return {
    ok: true,
    command: formatCommand(args),
    args,
    chainId: spec.chainId,
    networkTag: spec.networkTag,
  };
}

export function buildSnapshotVerifyCommand(options: SnapshotVerifyOptions): CliCommandResult {
  const spec = CLI_NETWORK_SPECS[options.network];
  const pathCheck = validateFilePath(options.snapshotPath, "Snapshot path");
  if (!pathCheck.ok) return pathCheck;

  const args: string[] = ["snapshot", "verify", pathCheck.value];

  if (options.includeExpectedChainId ?? true) {
    args.push("--expected-chain-id", String(spec.chainId));
  }

  if (options.json) {
    args.push("--json");
  }

  return {
    ok: true,
    command: formatCommand(args),
    args,
    chainId: spec.chainId,
    networkTag: spec.networkTag,
  };
}

export function buildTxDecodeCommand(options: TxDecodeOptions): CliCommandResult {
  const spec = CLI_NETWORK_SPECS[options.network];
  const hexCheck = validateHexPayload(options.rawTxHex, "Raw transaction hex");
  if (!hexCheck.ok) return hexCheck;

  const args: string[] = ["tx", "decode", hexCheck.value];

  if (options.includeChainId ?? true) {
    args.push("--chain-id", String(spec.chainId));
  }

  if (options.json) {
    args.push("--json");
  }

  return {
    ok: true,
    command: formatCommand(args),
    args,
    chainId: spec.chainId,
    networkTag: spec.networkTag,
  };
}

export function buildTxEnvelopeCommand(options: TxEnvelopeOptions): CliCommandResult {
  const spec = CLI_NETWORK_SPECS[options.network];

  if (options.mode === "encode") {
    const hexCheck = validateHexPayload(options.rawTxHex ?? "", "Raw transaction hex");
    if (!hexCheck.ok) return hexCheck;

    const kind: AirgapTxKind = options.kind ?? "raw";
    if (kind !== "transfer" && kind !== "call" && kind !== "raw") {
      return {
        ok: false,
        error: "Envelope kind must be 'transfer', 'call', or 'raw'.",
      };
    }

    const args: string[] = [
      "tx",
      "envelope",
      "encode",
      hexCheck.value,
      "--chain-id",
      String(spec.chainId),
      "--kind",
      kind,
    ];

    const signingHashRaw = options.signingHash?.trim() ?? "";
    if (signingHashRaw) {
      const hashCheck = validateHexPayload(signingHashRaw, "Signing hash", 32);
      if (!hashCheck.ok) return hashCheck;
      args.push("--signing-hash", hashCheck.value);
    }

    if (options.json) {
      args.push("--json");
    }

    return {
      ok: true,
      command: formatCommand(args),
      args,
      chainId: spec.chainId,
      networkTag: spec.networkTag,
    };
  }

  const envCheck = validateAirgapEnvelope(options.envelope ?? "");
  if (!envCheck.ok) return envCheck;

  const args: string[] = ["tx", "envelope", "decode", envCheck.value];

  if (options.includeExpectedChainId ?? true) {
    args.push("--expected-chain-id", String(spec.chainId));
  }

  if (options.json) {
    args.push("--json");
  }

  return {
    ok: true,
    command: formatCommand(args),
    args,
    chainId: spec.chainId,
    networkTag: spec.networkTag,
  };
}

export function buildKeyInspectCommand(options: KeyInspectOptions): CliCommandResult {
  const pathCheck = validateFilePath(options.keyfilePath, "Keystore path");
  if (!pathCheck.ok) return pathCheck;

  const args: string[] = ["key", "inspect", pathCheck.value];

  if (options.json) {
    args.push("--json");
  }

  return {
    ok: true,
    command: formatCommand(args),
    args,
    chainId: null,
    networkTag: null,
  };
}

export function buildCliCommand(request: CliCommandRequest): CliCommandResult {
  switch (request.command) {
    case "node-doctor":
      return buildNodeDoctorCommand(request);
    case "rpc-probe":
      return buildRpcProbeCommand(request);
    case "snapshot-verify":
      return buildSnapshotVerifyCommand(request);
    case "tx-decode":
      return buildTxDecodeCommand(request);
    case "tx-envelope":
      return buildTxEnvelopeCommand(request);
    case "key-inspect":
      return buildKeyInspectCommand(request);
  }
}
