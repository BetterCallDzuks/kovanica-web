import { createMiddleware, createStart } from "@tanstack/react-start";
import { createNonce, securityHeaders } from "@/lib/security-headers";
import type { StatusOverride } from "@/lib/response-status";

/**
 * Every response (SSR HTML, /api/*, server functions) gets the app-owned
 * security headers. The CSP nonce rides the request context to `getRouter`,
 * which stamps it on the SSR scripts.
 *
 * `statusOverride` lets a route loader that caught an upstream failure ask for
 * a 502/503/501 instead of the 500 Router assigns to any thrown error.
 */
const securityHeadersMiddleware = createMiddleware().server(async ({ next, request }) => {
  const nonce = createNonce();
  const statusOverride: StatusOverride = { status: null };
  const result = await next({ context: { nonce, statusOverride } });

  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const extra = securityHeaders({ host, nonce, dev: import.meta.env.DEV });

  const res = result.response;
  const status = statusOverride.status ?? res.status;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  result.response = new Response(res.body, {
    status,
    statusText: status === res.status ? res.statusText : "",
    headers,
  });
  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware],
}));
