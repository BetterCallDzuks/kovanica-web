/**
 * Public, build-time network configuration (safe to ship to the browser).
 *
 * Hosts and ports are never hardcoded in components: everything comes from
 * `KOVANICA_PUBLIC_*` env vars (exposed to the client via Vite `envPrefix`, see
 * vite.config.ts) with DNS-name defaults. Never put IP addresses here — see
 * `.env.example`.
 */

type EnvBag = Record<string, string | undefined>;

export const DEFAULT_SEED_PEERS = "seed1.kovanica.online:8000";
export const DEFAULT_P2P_PORT = 8000;


/** Read an env var from Vite (`import.meta.env`) or Node (`process.env`); blank = unset. */
function readEnv(key: string): string | undefined {
  const viteEnv = (import.meta as { env?: EnvBag }).env;
  const nodeEnv: EnvBag | undefined =
    typeof process !== "undefined" ? (process.env as EnvBag) : undefined;
  const raw = viteEnv?.[key] ?? nodeEnv?.[key];
  const value = raw?.trim();
  return value ? value : undefined;
}

/** Split a comma/whitespace separated `host:port` list, dropping empties. */
export function parsePeerList(value: string | undefined, fallback: string): string[] {
  const list = (value ?? fallback)
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (list.length > 0 || value === undefined) return list;
  return parsePeerList(undefined, fallback);
}

/** Parse a TCP port (1..65535); anything else falls back. */
export function parsePort(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : fallback;
}

/** Validate a WebSocket endpoint URL (`ws://` or `wss://`); invalid or blank returns `null`. */
export function parseWsUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Bootstrap seeds clones should dial (`host:port`, DNS names only). */
export const SEED_PEERS: string[] = parsePeerList(
  readEnv("KOVANICA_PUBLIC_SEED_PEERS"),
  DEFAULT_SEED_PEERS,
);

/** Comma-joined form, as the node's `KOVANICA_PEERS` expects it. */
export const SEED_PEERS_CSV: string = SEED_PEERS.join(",");

/** Primary seed (first entry). */
export const PRIMARY_SEED: string = SEED_PEERS[0] ?? "";

/** TCP port of the P2P protocol. */
export const P2P_PORT: number = parsePort(readEnv("KOVANICA_PUBLIC_P2P_PORT"), DEFAULT_P2P_PORT);

/** Optional public WebSocket JSON-RPC URL (`ws://` or `wss://`) for Explorer live streaming. */
export const PUBLIC_WS_URL: string | null = parseWsUrl(readEnv("KOVANICA_PUBLIC_WS_URL"));




