/**
 * Server-only endpoint resolution for kovanica-testnet (chain ID 2).
 *
 * The app talks to seed1's public JSON-RPC directly. The endpoint is anonymous:
 * no token, no `Authorization` header, no IP fallback. Reads work; write methods
 * answer HTTP 401 on the public RPC, which callers surface as
 * "writes are not available via the public RPC" (PRO-53 tracks the rollout).
 *
 * Path check (anonymous `kovanica_syncStatus`, 2026-11-15):
 *   POST https://rpc-testnet.kovanica.online/     → 200
 *   POST https://rpc-testnet.kovanica.online/rpc  → 200
 * `/rpc` is the explicit JSON-RPC route, so it is the default.
 */

const DEFAULT_RPC_URL = "https://rpc-testnet.kovanica.online/rpc";

/** Same budget the upstream probe uses. */
export const RPC_TIMEOUT_MS = 8000;

export class RpcError extends Error {
  /** HTTP status when the endpoint answered, otherwise null (transport failure). */
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "RpcError";
    this.status = status;
  }
}

function envValue(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** JSON-RPC endpoint. `KOVANICA_RPC_URL` wins; otherwise the verified `/rpc`. */
export function rpcEndpoint(): string {
  const url = new URL(envValue("KOVANICA_RPC_URL") ?? DEFAULT_RPC_URL);
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/rpc";
  return url.toString();
}

/** Origin only, for endpoints that live next to the RPC route (`/health`). */
export function rpcOrigin(): string {
  return new URL(rpcEndpoint()).origin;
}

/** Liveness probe: 200 = live, 503 = stalled. */
export function healthEndpoint(): string {
  return `${rpcOrigin()}/health`;
}

/**
 * Faucet endpoint, or null when the operator has not configured one.
 * No IP default: an unset faucet is reported as unavailable, not as a dead host.
 */
export function faucetEndpoint(): string | null {
  return envValue("KOVANICA_FAUCET_URL");
}

/**
 * Optional server-only Bearer token for authenticated write RPC methods
 * (`kovanica_sendRawTransaction`). Mirrors `kovanica-faucet`: prefers
 * `KOVANICA_RPC_WRITE_TOKEN`, falling back to the first entry of
 * `KOVANICA_RPC_WRITE_TOKENS`. Never exposed to the browser.
 */
export function rpcWriteToken(): string | null {
  const single = envValue("KOVANICA_RPC_WRITE_TOKEN");
  if (single) return single;
  const list = envValue("KOVANICA_RPC_WRITE_TOKENS");
  if (!list) return null;
  const first = list
    .split(",")
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  return first ?? null;
}

/** One JSON-RPC call (attaching server-side Bearer token when configured), bounded by `RPC_TIMEOUT_MS`. */
export async function rpcCall<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = rpcWriteToken();
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    const res = await fetch(rpcEndpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const message =
        res.status === 401 ? "writes are not available via the public RPC" : `RPC HTTP ${res.status}`;
      throw new RpcError(message, res.status);
    }
    const data = (await res.json()) as { result?: T; error?: { message?: string } };
    if (data.error) throw new RpcError(data.error.message ?? "RPC error", res.status);
    return data.result as T;
  } catch (e) {
    if (e instanceof RpcError) throw e;
    throw new RpcError(e instanceof Error ? e.message : "RPC unreachable", null);
  } finally {
    clearTimeout(timer);
  }
}

export type HealthProbeResult = {
  /** HTTP status of GET /health, or null when it never answered. */
  status: number | null;
  /** True when the probe failed before any HTTP response (DNS/TCP/timeout). */
  failed: boolean;
  checkedAt: number;
};

/** Probe `<rpc origin>/health`. Never throws: a failure is `{ failed: true }`. */
export async function probeHealth(): Promise<HealthProbeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(healthEndpoint(), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    });
    // Body is intentionally unread: only the status classifies health.
    await res.body?.cancel().catch(() => {});
    return { status: res.status, failed: false, checkedAt: Date.now() };
  } catch {
    return { status: null, failed: true, checkedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}
