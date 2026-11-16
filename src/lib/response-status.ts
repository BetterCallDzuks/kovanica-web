import { getGlobalStartContext } from "@tanstack/react-start";

/** Mutable, request-scoped holder created by the middleware in `src/start.ts`. */
export type StatusOverride = { status: number | null };

/**
 * Ask for a specific HTTP status for the current SSR response. No-op in the
 * browser (client navigations have no response) and outside a request.
 */
export function requestResponseStatus(status: number): void {
  if (typeof window !== "undefined") return;
  try {
    const ctx = getGlobalStartContext() as { statusOverride?: StatusOverride } | undefined;
    if (ctx?.statusOverride) ctx.statusOverride.status = status;
  } catch {
    /* outside a request: nothing to set */
  }
}

/** The CSP nonce for this request (server only); undefined in the browser. */
export function requestNonce(): string | undefined {
  if (typeof window !== "undefined") return undefined;
  try {
    const ctx = getGlobalStartContext() as { nonce?: string } | undefined;
    return ctx?.nonce;
  } catch {
    return undefined;
  }
}
