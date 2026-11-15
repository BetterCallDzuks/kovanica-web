/**
 * Health vocabulary shared by the server probe and every surface that renders it.
 *
 * `GET <rpc origin>/health` is the source of truth for chain liveness:
 *   200 → live      the chain is committing
 *   503 → stalled   the node answers but the chain is not advancing
 *   none → down     DNS/TCP/timeout, or any other HTTP status
 *
 * A stalled chain is *not* a down endpoint: reads still answer, so the UI must
 * never fold 503 into "offline".
 */

export type HealthState = "live" | "stalled" | "down";

/** Raw inputs for the pure classifier. Only status codes, never bodies. */
export type HealthProbeInput = {
  /** HTTP status of GET /health, or null when it never answered. */
  healthStatus?: number | null;
  /** HTTP status of the JSON-RPC call itself, when it answered. */
  rpcStatus?: number | null;
  /** True when the request failed before any HTTP response (DNS/TCP/timeout). */
  failed?: boolean;
};

/**
 * Classify liveness. `healthStatus` wins over `rpcStatus` because /health is the
 * dedicated liveness probe; a 200 there means the chain is advancing even if a
 * single read raced a restart.
 */
export function classifyHealth(probe: HealthProbeInput): HealthState {
  if (probe.failed) return "down";
  if (probe.healthStatus === 200) return "live";
  if (probe.healthStatus === 503) return "stalled";
  if (probe.rpcStatus === 200) return "live";
  if (probe.rpcStatus === 503) return "stalled";
  return "down";
}

/** The single user-facing label per state. Never say "down" for a stalled chain. */
export const HEALTH_LABEL: Record<HealthState, string> = {
  live: "Live",
  stalled: "Stalled — chain not advancing",
  down: "Down",
};

export function healthLabel(state: HealthState): string {
  return HEALTH_LABEL[state];
}

/** Tailwind-ish tone hints for surfaces that render the label. */
export function healthTone(state: HealthState): "ok" | "warn" | "danger" {
  if (state === "live") return "ok";
  if (state === "stalled") return "warn";
  return "danger";
}

/** Shape exposed on /api/health and embedded in /api/state + /api/bootstrap. */
export type HealthSummary = {
  state: HealthState;
  /** Status of GET /health, or null when it never answered. */
  status: number | null;
  checkedAt: number;
};

export function isHealthState(value: unknown): value is HealthState {
  return value === "live" || value === "stalled" || value === "down";
}

/** Read a HealthState out of an /api/health payload without trusting its shape. */
export function healthFromPayload(payload: unknown): HealthState {
  if (payload && typeof payload === "object" && "state" in payload) {
    const state = (payload as { state?: unknown }).state;
    if (isHealthState(state)) return state;
  }
  return "down";
}

/**
 * HTTP status carried by a rejected API/fetch call, or null when it never
 * answered. Lets surfaces distinguish a 503 stalled chain from a 502/transport
 * outage without parsing message text.
 */
export function errorStatusOf(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}

export type FaucetErrorKind =
  | "cap"
  | "dry"
  | "cooldown"
  | "stalled"
  | "unavailable"
  | "offline"
  | "other";

/**
 * Map a faucet failure to a message kind. HTTP 503 is a *stalled* chain, never
 * "offline"; only transport failures and 502/504 are offline.
 */
export function classifyFaucetError(message: string, status?: number | null): FaucetErrorKind {
  const m = message.toLowerCase();
  if (/unavailable|not configured|not set/.test(m)) return "unavailable";
  if (status === 503 || /stalled|not advancing/.test(m)) return "stalled";
  if (/cap|limit|max|exceed|exhausted/i.test(m)) return "cap";
  if (/dry|insufficient|no funds|out of funds|unfunded/i.test(m)) return "dry";
  if (/cooldown|recent|too soon|wait/i.test(m)) return "cooldown";
  if (status === 502 || status === 504) return "offline";
  if (/unreachable|offline|timeout|aborted|upstream|refused|network|fetch failed/i.test(m))
    return "offline";
  // No HTTP response at all is a transport failure, not a server-side error.
  if (status == null) return "offline";
  return "other";
}
