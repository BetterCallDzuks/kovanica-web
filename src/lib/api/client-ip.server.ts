/**
 * Client IP resolution for the one hop to the faucet.
 *
 * The faucet rate-limits per client IP, so every request that arrives from this
 * web app must carry the *user's* address, not the web server's. The address can
 * only be recovered from the reverse-proxy headers nginx writes:
 *
 *   proxy_set_header X-Real-IP $remote_addr;                     # overwritten
 *   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;  # appended
 *
 * `X-Real-IP` is *set* by nginx, so a client-supplied value is overwritten.
 * `X-Forwarded-For` is *appended*, so the client's own value ends up on the left
 * and nginx's `$remote_addr` is always the last hop. Taking the last hop and
 * preferring `X-Real-IP` therefore never forwards a value the client chose.
 *
 * Trust boundary: the app listens on loopback (127.0.0.1:3010) and only nginx
 * can reach it. If this app is ever exposed directly, set
 * `KOVANICA_TRUST_PROXY_HEADERS=0`; the headers are then ignored and the faucet
 * keys on the web server's address (one shared bucket) instead of trusting them.
 */
import { isIP } from "node:net";

/** Escape hatch for a deployment where the web app itself is public. */
export const TRUST_PROXY_HEADERS_ENV = "KOVANICA_TRUST_PROXY_HEADERS";

/** True unless `KOVANICA_TRUST_PROXY_HEADERS` explicitly disables it. */
export function trustProxyHeaders(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[TRUST_PROXY_HEADERS_ENV]?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

/** `null` unless `raw` is exactly an IPv4 or IPv6 literal (no ports, no lists). */
export function parseIpLiteral(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (value.length === 0) return null;
  // Tolerate the bracketed IPv6 form some proxies emit.
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  return isIP(value) === 0 ? null : value;
}

/**
 * The user's address as attested by the trusted reverse proxy, or `null`.
 *
 * `null` means "unknown": the caller must omit the forwarding header rather than
 * invent one, so the faucet falls back to the socket peer.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  if (!trustProxyHeaders()) return null;

  const realIp = parseIpLiteral(headers.get("x-real-ip"));
  if (realIp) return realIp;

  const forwardedFor = headers.get("x-forwarded-for");
  if (!forwardedFor) return null;
  const hops = forwardedFor
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);
  // Last hop = the address nginx appended. Earlier hops are client-controlled.
  const lastHop = hops.length > 0 ? hops[hops.length - 1] : null;
  return parseIpLiteral(lastHop);
}
