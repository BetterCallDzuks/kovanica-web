import {
  MAINNET_ID,
  MAINNET_NETWORK_TAG,
  NETWORK_ID,
  DEVNET_ID,
  TESTNET_NETWORK_TAG,
  type ApiSource,
  type ApiState,
} from "@/lib/networkConstants";
import type { LiveStreamTransport } from "@/lib/api/ws-stream";

export const DIAGNOSTICS_SCHEMA_VERSION = 1 as const;

export interface BuildExplorerDiagnosticsInput {
  source: ApiSource;
  transport: LiveStreamTransport;
  paused: boolean;
  state: (ApiState & { network_tag?: string | null }) | null;
  error?: string | null;
  errorStatus?: number | null;
  generatedAt?: Date | string | number;
}

export interface ExplorerDiagnosticsSnapshot {
  schemaVersion: typeof DIAGNOSTICS_SCHEMA_VERSION;
  source: ApiSource;
  transport: LiveStreamTransport;
  paused: boolean;
  chainId: number | null;
  networkTag: string | null;
  networkTagVerified: boolean;
  committedHeight: number | null;
  blueScore: number | null;
  peerCount: number | null;
  mempoolCount: number | null;
  tipCount: number | null;
  health: string | null;
  errorStatus: number | null;
  error: string | null;
  generatedAt: string;
}

const MAX_ERROR_LENGTH = 240;

/**
 * Redacts authentication tokens, cookies, URL credentials, JWTs, and private
 * key/seed material from diagnostic text before it can be surfaced or copied.
 */
export function sanitizeDiagnosticText(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const redacted = trimmed
    // URL embedded credentials: https://user:pass@host
    .replace(/\b(https?|wss?):\/\/[^/\s:@]+:[^/\s@]+@/gi, "$1://[REDACTED]@")
    // Authorization / Cookie / API key header fragments
    .replace(
      /\b(authorization|cookie|set-cookie|x-api-key|x-auth-token)\s*:\s*[^\r\n;]+/gi,
      "$1: [REDACTED]",
    )
    // Bearer / Basic schemes
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    // JWTs (header.payload.signature)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    // Query params or key=value pairs with sensitive names
    .replace(
      /\b(token|access_token|refresh_token|id_token|api[_-]?key|secret|password|passwd|cookie|session|auth|mnemonic|seed|private[_-]?key)\s*[:=]\s*[^\s&;,"']+/gi,
      "$1=[REDACTED]",
    );

  return redacted.length > MAX_ERROR_LENGTH
    ? `${redacted.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : redacted;
}

function normalizeGeneratedAt(generatedAt?: Date | string | number): string {
  if (generatedAt instanceof Date) {
    return Number.isNaN(generatedAt.getTime())
      ? new Date().toISOString()
      : generatedAt.toISOString();
  }
  if (typeof generatedAt === "string" || typeof generatedAt === "number") {
    const parsed = new Date(generatedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function resolveChainId(state: ApiState | null): number | null {
  if (!state) return null;
  if (typeof state.chain_id === "number" && Number.isFinite(state.chain_id)) {
    return state.chain_id;
  }
  if (state.network === NETWORK_ID) return 2;
  if (state.network === MAINNET_ID) return 1;
  if (state.network === DEVNET_ID) return 3;
  return null;
}

function resolveNetworkTag(
  state: (ApiState & { network_tag?: string | null }) | null,
  chainId: number | null,
): string | null {
  if (!state) return null;
  if (typeof state.network_tag === "string" && state.network_tag.trim().length > 0) {
    return sanitizeDiagnosticText(state.network_tag);
  }
  if (chainId === 2 || state.network === NETWORK_ID) {
    return TESTNET_NETWORK_TAG;
  }
  if (chainId === 1 || state.network === MAINNET_ID) {
    return MAINNET_NETWORK_TAG;
  }
  return null;
}

function verifyNetworkTag(
  source: ApiSource,
  chainId: number | null,
  networkTag: string | null,
): boolean {
  if (!networkTag) return false;
  if (source === "testnet") {
    return networkTag === TESTNET_NETWORK_TAG && (chainId === null || chainId === 2);
  }
  if (source === "mainnet") {
    return networkTag === MAINNET_NETWORK_TAG && (chainId === null || chainId === 1);
  }
  // Local in-memory node: verified when reporting a canonical testnet or mainnet tag
  return (
    (networkTag === TESTNET_NETWORK_TAG && (chainId === null || chainId === 2)) ||
    (networkTag === MAINNET_NETWORK_TAG && (chainId === null || chainId === 1))
  );
}

/**
 * Builds a sanitized, support-safe Explorer node & network diagnostics snapshot.
 * Strictly omits wallet addresses/seeds, raw peer endpoints, headers, cookies,
 * and redacts any credentials that might appear in error messages.
 */
export function buildExplorerDiagnosticsSnapshot(
  input: BuildExplorerDiagnosticsInput,
): ExplorerDiagnosticsSnapshot {
  const { source, transport, paused, state, error, errorStatus, generatedAt } = input;

  const chainId = resolveChainId(state);
  const networkTag = resolveNetworkTag(state, chainId);
  const networkTagVerified = verifyNetworkTag(source, chainId, networkTag);

  const committedHeight =
    typeof state?.node?.blocks === "number" && Number.isFinite(state.node.blocks)
      ? state.node.blocks
      : null;

  const blueScore =
    typeof state?.node?.blue_score === "number" && Number.isFinite(state.node.blue_score)
      ? state.node.blue_score
      : null;

  const peerCount = Array.isArray(state?.peers) ? state.peers.length : null;

  const mempoolCount =
    typeof state?.node?.mempool === "number" && Number.isFinite(state.node.mempool)
      ? state.node.mempool
      : null;

  const tipCount = Array.isArray(state?.node?.tips) ? state.node.tips.length : null;

  const normalizedErrorStatus =
    typeof errorStatus === "number" && Number.isFinite(errorStatus) ? errorStatus : null;

  const sanitizedError = sanitizeDiagnosticText(error);

  const health =
    state?.health?.state ??
    (normalizedErrorStatus === 503
      ? "stalled"
      : sanitizedError
        ? "unreachable"
        : state
          ? "live"
          : null);

  return {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    source,
    transport,
    paused: Boolean(paused),
    chainId,
    networkTag,
    networkTagVerified,
    committedHeight,
    blueScore,
    peerCount,
    mempoolCount,
    tipCount,
    health,
    errorStatus: normalizedErrorStatus,
    error: sanitizedError,
    generatedAt: normalizeGeneratedAt(generatedAt),
  };
}

/** Formats a diagnostics snapshot as pretty-printed JSON suitable for support bundles. */
export function formatDiagnosticsJson(snapshot: ExplorerDiagnosticsSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
