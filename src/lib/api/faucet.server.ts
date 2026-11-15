/**
 * The server-side hop from `POST /api/faucet` to the kovanica-testnet faucet.
 *
 * Two things matter here:
 *
 * 1. **Forward the user's address.** The faucet rate-limits per client IP, so the
 *    user's address (as attested by nginx, see `client-ip.server.ts`) travels in
 *    `X-Forwarded-For`. Without it every user shares the web server's bucket.
 *    Nothing else from the incoming request is forwarded: no `Authorization`,
 *    no cookies.
 * 2. **Report what the faucet actually did.** The dispense amount is fixed
 *    server-side by the faucet; the browser must never choose or invent it.
 */
import { classifyFaucetError, type FaucetErrorKind } from "./health";
import { clientIpFromHeaders } from "./client-ip.server";
import { faucetEndpoint } from "./rpc-url.server";

/** The faucet is a local hop; ten seconds is a generous ceiling. */
export const FAUCET_TIMEOUT_MS = 10_000;

/** A faucet failure carrying the message kind the UI renders. */
export class FaucetError extends Error {
  readonly kind: FaucetErrorKind;
  /** HTTP status the faucet answered with, or null when it never answered. */
  readonly status: number | null;

  constructor(message: string, kind: FaucetErrorKind, status: number | null) {
    super(message);
    this.name = "FaucetError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Map a faucet failure to the shared message vocabulary.
 *
 * 429 is the faucet's cooling-down answer for a repeated IP or address, and 503
 * is either a dry faucet or an unusable one — never "stalled", which is reserved
 * for the chain's own `/health`.
 */
export function faucetErrorKind(message: string, status: number | null): FaucetErrorKind {
  if (status === 429) return "cooldown";
  if (status === 503) {
    return /fund|balance|dry|insufficient/i.test(message) ? "dry" : "unavailable";
  }
  return classifyFaucetError(message, status);
}

/** What the faucet granted, in atoms, plus its own wording. */
export type FaucetGrant = {
  ok: true;
  tx_hash: string | null;
  /** Dispensed amount in atoms (9 decimals), or null when the faucet omitted it. */
  amount: number | null;
  message: string;
};

/**
 * Read the dispensed amount out of the faucet's own message ("Dispensed 10 KVNC").
 *
 * The faucet's success body carries `message` and `tx_hash` only, and its amount
 * is fixed by the operator's `--dispense-kovanica`. Parsing the message keeps the
 * UI honest if that value ever changes. A future `amount_atoms` field wins.
 */
export function dispensedAtoms(message: string, amountAtoms?: unknown): number | null {
  if (typeof amountAtoms === "number" && Number.isFinite(amountAtoms) && amountAtoms > 0) {
    return Math.round(amountAtoms);
  }
  const match = /(\d+(?:\.\d+)?)\s*KVNC/i.exec(message);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 1e9);
}

type FaucetBody = {
  message?: unknown;
  error?: unknown;
  tx_hash?: unknown;
  tx?: unknown;
  amount_atoms?: unknown;
};

function bodyMessage(body: FaucetBody | null, status: number): string {
  if (typeof body?.message === "string" && body.message.trim()) return body.message;
  if (typeof body?.error === "string" && body.error.trim()) return body.error;
  return `Faucet HTTP ${status}`;
}

/**
 * Ask the faucet for a fixed dispense to `address`.
 *
 * `incomingHeaders` are the browser's headers; only the proxy-attested client IP
 * is derived from them.
 */
export async function dispenseFromFaucet(
  address: string,
  incomingHeaders: Headers,
): Promise<FaucetGrant> {
  const endpoint = faucetEndpoint();
  if (!endpoint) throw new FaucetError("The faucet is not available on this deployment.", "unavailable", null);

  const clientIp = clientIpFromHeaders(incomingHeaders);
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Only the proxy-attested address, and only when we actually have one.
  if (clientIp) headers["x-forwarded-for"] = clientIp;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FAUCET_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ address }),
      signal: ctrl.signal,
    });
  } catch {
    throw new FaucetError("The faucet is unreachable (timeout or network error).", "offline", null);
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text().catch(() => "");
  let body: FaucetBody | null = null;
  if (raw) {
    try {
      body = JSON.parse(raw) as FaucetBody;
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const message = bodyMessage(body, res.status);
    throw new FaucetError(message, faucetErrorKind(message, res.status), res.status);
  }

  const message = bodyMessage(body, res.status);
  const txHash =
    typeof body?.tx_hash === "string"
      ? body.tx_hash
      : typeof body?.tx === "string"
        ? body.tx
        : null;

  return {
    ok: true,
    tx_hash: txHash,
    amount: dispensedAtoms(message, body?.amount_atoms),
    message,
  };
}

/** Browser status for a faucet failure: keep 429/503 distinguishable. */
export function faucetHttpStatus(kind: FaucetErrorKind): number {
  switch (kind) {
    case "cooldown":
      return 429;
    case "dry":
    case "unavailable":
      return 503;
    case "offline":
      return 502;
    case "stalled":
      return 503;
    default:
      return 400;
  }
}
