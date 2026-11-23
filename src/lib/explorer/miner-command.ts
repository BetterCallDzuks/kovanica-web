/**
 * Pure, dependency-free KovanicaHash Miner & Stratum TLS CLI command builder.
 *
 * Generates safe, shell-escaped `kovanica mine ...` commands matching
 * `kovanica-cli`'s exact flags (`--stratum`, `--tls`, `--tls-server-name`,
 * `--tls-ca-cert`, `--rpc-url`, `--address`, `--worker`, `--threads`,
 * `--chain-id`) while rejecting shell metacharacters and invalid inputs.
 */

export type MinerMode = "stratum" | "solo";
export type MinerNetwork = "testnet" | "mainnet" | "devnet";

export interface MinerNetworkSpec {
  readonly network: MinerNetwork;
  readonly label: string;
  readonly chainId: 1 | 2 | 3;
  readonly networkTag: string | null;
  readonly defaultStratumEndpoint: string;
  readonly defaultRpcEndpoint: string;
}

/** Frozen Kovanica consensus & emission constants (DO NOT alter). */
export const MINER_CONSENSUS_SPECS = {
  powAlgorithm: "KovanicaHash",
  ghostdagK: 5,
  targetBlockTimeSec: 4,
  initialRewardKvnc: 2.5,
  blocksPerEra: 8_200_000,
  eraDecayNumerator: 3,
  eraDecayDenominator: 4,
} as const;

export const MINER_NETWORK_SPECS: Record<MinerNetwork, MinerNetworkSpec> = {
  mainnet: {
    network: "mainnet",
    label: "Mainnet (Chain 1)",
    chainId: 1,
    networkTag: "1-f35df34c92001436",
    defaultStratumEndpoint: "stratum+tls://pool.kovanica.online:3333",
    defaultRpcEndpoint: "http://127.0.0.1:8545",
  },
  testnet: {
    network: "testnet",
    label: "Testnet (Chain 2)",
    chainId: 2,
    networkTag: "2-24cdb5fadd98b207",
    defaultStratumEndpoint: "stratum+tls://pool.kovanica.online:3333",
    defaultRpcEndpoint: "http://127.0.0.1:8545",
  },
  devnet: {
    network: "devnet",
    label: "Devnet (Chain 3)",
    chainId: 3,
    networkTag: null,
    defaultStratumEndpoint: "stratum+tcp://127.0.0.1:3333",
    defaultRpcEndpoint: "http://127.0.0.1:8545",
  },
};

export const EXAMPLE_PRO21_PAYOUT_ADDRESS =
  "kvnc8d4z00xwk6jz6c4r4rgz5mcdwdjny9thrh3y8f36cpy2rz6emg54rufktdag";

export interface MinerCommandOptions {
  mode: MinerMode;
  network: MinerNetwork;
  endpoint: string;
  payoutAddress: string;
  workerName?: string;
  threads?: number;
  tls?: boolean;
  tlsServerName?: string;
  tlsCaCert?: string;
}

export type MinerCommandResult =
  | {
      ok: true;
      command: string;
      chainId: 1 | 2 | 3;
      networkTag: string | null;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Any ASCII control character or POSIX shell metacharacter that could alter
 * command parsing or inject subshells, pipes, redirections, or globs.
 */
// eslint-disable-next-line no-control-regex
const SHELL_METACHAR_RE = /[\x00-\x1f\x7f;|&`$()<>'"\\*?[\]!~#{}\s]/;

/** Canonical PRO-21 address: `kvnc` + 57 bech32-alphabet chars + `dag` (64 total). */
const PRO21_ADDRESS_RE = /^kvnc[02-9ac-hj-np-z]{57}dag$/;

/** Legacy 32-byte hex address accepted only on devnet (Chain 3). */
const LEGACY_HEX_ADDRESS_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;

/** Safe worker name identifier. */
const WORKER_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Safe DNS hostname / SNI server name. */
const HOSTNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

/** Safe PEM CA certificate file path (no whitespace or shell metacharacters). */
const CA_CERT_PATH_RE = /^[A-Za-z0-9._/:-]{1,256}$/;

/** Safe unquoted POSIX shell token. */
const SAFE_UNQUOTED_TOKEN_RE = /^[A-Za-z0-9._:/+-]+$/;

export function containsShellMetacharacters(value: string): boolean {
  return SHELL_METACHAR_RE.test(value);
}

/**
 * Shell-escape a validated CLI argument using POSIX single quotes when needed.
 */
export function shellEscape(value: string): string {
  if (SAFE_UNQUOTED_TOKEN_RE.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function validatePayoutAddress(
  address: string,
  network: MinerNetwork,
): { ok: true; normalized: string } | { ok: false; error: string } {
  const trimmed = address.trim();
  if (!trimmed) {
    return { ok: false, error: "Payout address is required." };
  }
  if (containsShellMetacharacters(trimmed)) {
    return {
      ok: false,
      error: "Payout address contains disallowed whitespace or shell metacharacters.",
    };
  }

  const lower = trimmed.toLowerCase();
  if (PRO21_ADDRESS_RE.test(lower)) {
    return { ok: true, normalized: lower };
  }

  if (LEGACY_HEX_ADDRESS_RE.test(trimmed)) {
    if (network === "devnet") {
      return { ok: true, normalized: lower };
    }
    return {
      ok: false,
      error:
        "Canonical PRO-21 address (kvnc…dag) is required on Mainnet (Chain 1) and Testnet (Chain 2); legacy hex is devnet-only.",
    };
  }

  return {
    ok: false,
    error: "Invalid payout address. Expected canonical PRO-21 format (kvnc + 57 bech32 chars + dag).",
  };
}

function validateStratumEndpoint(
  raw: string,
): { ok: true; normalized: string; usesTlsScheme: boolean; usesTcpScheme: boolean } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Stratum endpoint is required." };
  }
  if (containsShellMetacharacters(trimmed)) {
    return {
      ok: false,
      error: "Stratum endpoint contains disallowed whitespace or shell metacharacters.",
    };
  }

  let usesTlsScheme = false;
  let usesTcpScheme = false;
  let hostPort = trimmed;

  if (trimmed.startsWith("stratum+tls://")) {
    usesTlsScheme = true;
    hostPort = trimmed.slice("stratum+tls://".length);
  } else if (trimmed.startsWith("stratum+tcp://")) {
    usesTcpScheme = true;
    hostPort = trimmed.slice("stratum+tcp://".length);
  } else if (trimmed.includes("://")) {
    return {
      ok: false,
      error: "Stratum endpoint scheme must be stratum+tls://, stratum+tcp://, or host:port.",
    };
  }

  const colonIdx = hostPort.lastIndexOf(":");
  if (colonIdx <= 0 || colonIdx === hostPort.length - 1) {
    return {
      ok: false,
      error: "Stratum endpoint must include both host and port (e.g. stratum+tls://pool.kovanica.online:3333).",
    };
  }

  const host = hostPort.slice(0, colonIdx);
  const portStr = hostPort.slice(colonIdx + 1);
  if (!HOSTNAME_RE.test(host)) {
    return { ok: false, error: "Stratum endpoint host is invalid." };
  }
  if (!/^\d{1,5}$/.test(portStr)) {
    return { ok: false, error: "Stratum endpoint port must be a valid TCP port (1–65535)." };
  }
  const port = Number.parseInt(portStr, 10);
  if (port < 1 || port > 65535) {
    return { ok: false, error: "Stratum endpoint port must be between 1 and 65535." };
  }

  return { ok: true, normalized: trimmed, usesTlsScheme, usesTcpScheme };
}

function validateRpcEndpoint(
  raw: string,
): { ok: true; normalized: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Solo RPC URL is required." };
  }
  if (containsShellMetacharacters(trimmed)) {
    return {
      ok: false,
      error: "RPC URL contains disallowed whitespace or shell metacharacters.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid RPC URL. Expected http:// or https:// endpoint." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "RPC URL must use http:// or https://." };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "RPC URL must include a hostname." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "RPC URL must not embed credentials." };
  }

  return { ok: true, normalized: trimmed };
}

/**
 * Build a validated, shell-safe `kovanica mine ...` CLI command for either
 * Stratum V1 (with optional TLS) or Solo HTTP JSON-RPC mining.
 */
export function buildKovanicaMinerCommand(options: MinerCommandOptions): MinerCommandResult {
  const spec = MINER_NETWORK_SPECS[options.network];
  if (!spec) {
    return { ok: false, error: `Unsupported network "${String(options.network)}".` };
  }

  const addrCheck = validatePayoutAddress(options.payoutAddress, options.network);
  if (!addrCheck.ok) {
    return addrCheck;
  }

  if (options.threads !== undefined) {
    if (
      typeof options.threads !== "number" ||
      !Number.isFinite(options.threads) ||
      !Number.isInteger(options.threads) ||
      options.threads < 1 ||
      options.threads > 256
    ) {
      return { ok: false, error: "Thread count must be a whole number between 1 and 256." };
    }
  }

  const parts: string[] = ["kovanica", "mine", "--chain-id", String(spec.chainId)];

  if (options.mode === "stratum") {
    const endpointCheck = validateStratumEndpoint(options.endpoint);
    if (!endpointCheck.ok) {
      return endpointCheck;
    }

    if (options.tls === true && endpointCheck.usesTcpScheme) {
      return {
        ok: false,
        error: "TLS cannot be enabled with a plaintext stratum+tcp:// endpoint; use stratum+tls:// or host:port.",
      };
    }

    const effectiveTls = Boolean(options.tls) || endpointCheck.usesTlsScheme;

    parts.push("--stratum", shellEscape(endpointCheck.normalized));

    if (effectiveTls) {
      parts.push("--tls");
    }

    const trimmedServerName = options.tlsServerName?.trim() ?? "";
    if (trimmedServerName) {
      if (!effectiveTls) {
        return {
          ok: false,
          error: "--tls-server-name requires TLS to be enabled (or a stratum+tls:// endpoint).",
        };
      }
      if (containsShellMetacharacters(trimmedServerName) || !HOSTNAME_RE.test(trimmedServerName)) {
        return {
          ok: false,
          error: "TLS server name (SNI) must be a valid hostname without shell metacharacters.",
        };
      }
      parts.push("--tls-server-name", shellEscape(trimmedServerName));
    }

    const trimmedCaCert = options.tlsCaCert?.trim() ?? "";
    if (trimmedCaCert) {
      if (!effectiveTls) {
        return {
          ok: false,
          error: "--tls-ca-cert requires TLS to be enabled (or a stratum+tls:// endpoint).",
        };
      }
      if (containsShellMetacharacters(trimmedCaCert) || !CA_CERT_PATH_RE.test(trimmedCaCert)) {
        return {
          ok: false,
          error: "TLS CA cert path contains disallowed characters or shell metacharacters.",
        };
      }
      parts.push("--tls-ca-cert", shellEscape(trimmedCaCert));
    }

    parts.push("--address", shellEscape(addrCheck.normalized));

    const trimmedWorker = options.workerName?.trim() ?? "";
    if (trimmedWorker) {
      if (containsShellMetacharacters(trimmedWorker) || !WORKER_NAME_RE.test(trimmedWorker)) {
        return {
          ok: false,
          error: "Worker name may only contain letters, digits, '.', '_', and '-' (max 64 chars).",
        };
      }
      parts.push("--worker", shellEscape(trimmedWorker));
    }
  } else {
    const rpcCheck = validateRpcEndpoint(options.endpoint);
    if (!rpcCheck.ok) {
      return rpcCheck;
    }
    parts.push("--rpc-url", shellEscape(rpcCheck.normalized));
    parts.push("--address", shellEscape(addrCheck.normalized));
  }

  if (options.threads !== undefined) {
    parts.push("--threads", String(options.threads));
  }

  return {
    ok: true,
    command: parts.join(" "),
    chainId: spec.chainId,
    networkTag: spec.networkTag,
  };
}
