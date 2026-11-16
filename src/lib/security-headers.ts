import { isSandboxPreviewGuestHost } from "./preview-embedder-origin";

/**
 * App-owned security headers, applied to every response by the request
 * middleware in `src/start.ts`, for every host role in `host.ts`.
 *
 * The CSP is nonce-based: TanStack Start SSR streams inline bootstrap and
 * hydration scripts (`$_TSR`, dehydrated router state). Their content changes
 * per request, so hashes cannot cover them; `'unsafe-inline'` would. Each
 * request gets a fresh nonce, the router stamps it on every script it renders
 * (`ssr.nonce` in `src/router.tsx`) and the header allows only that nonce.
 *
 * The edge must not add a second Content-Security-Policy: browsers enforce
 * every policy they receive, so an extra policy without this nonce blocks the
 * hydration scripts again and the page renders blank.
 */

/** Cloudflare injects its Web Analytics beacon at the edge. */
const CF_INSIGHTS_SCRIPT = "https://static.cloudflareinsights.com";
const CF_INSIGHTS_REPORT = "https://cloudflareinsights.com";

/** IPFS gateways the RWA metadata helpers call from the browser. */
const IPFS_CONNECT = [
  "https://api.ipfs.io",
  "https://ipfs.io",
  "https://cloudflare-ipfs.com",
  "https://gateway.pinata.cloud",
];

/** Trezor Connect runs in an iframe/popup served from connect.trezor.io. */
const TREZOR_CONNECT = "https://connect.trezor.io";

/** Origins allowed to frame the live preview (`*.grok-sandbox.com` guests only). */
const PREVIEW_FRAME_ANCESTORS = [
  "'self'",
  "https://grok.com",
  "https://*.grok.com",
  "https://*.grok-sandbox.com",
];

export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

/**
 * Minimal Permissions-Policy. `usb` stays open to this origin and Trezor
 * Connect because the wallet talks to Ledger (WebUSB) and Trezor devices;
 * `clipboard-write` stays open for the copy buttons.
 */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "browsing-topics=()",
  "interest-cohort=()",
  `usb=(self "${TREZOR_CONNECT}")`,
  "clipboard-write=(self)",
].join(", ");

/** Only the live preview guest is ever framed; production hosts never are. */
export function isEmbeddableHost(host: string): boolean {
  const h = (host || "").toLowerCase().split(":")[0] ?? "";
  return isSandboxPreviewGuestHost(h);
}

/** 16 random bytes, base64 — a fresh CSP nonce per request. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function buildCsp(opts: { nonce: string; embeddable: boolean }): string {
  const frameAncestors = opts.embeddable ? PREVIEW_FRAME_ANCESTORS.join(" ") : "'none'";
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    // 'wasm-unsafe-eval' compiles vendor/kovanica-sdk-wasm; it does not allow eval().
    ["script-src", ["'self'", `'nonce-${opts.nonce}'`, "'wasm-unsafe-eval'", CF_INSIGHTS_SCRIPT]],
    // React writes inline style attributes; fonts come from Google Fonts.
    ["style-src", ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]],
    ["font-src", ["'self'", "data:", "https://fonts.gstatic.com"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    [
      "connect-src",
      ["'self'", "https://*.kovanica.online", ...IPFS_CONNECT, CF_INSIGHTS_REPORT, TREZOR_CONNECT],
    ],
    ["worker-src", ["'self'", "blob:"]],
    ["frame-src", [TREZOR_CONNECT]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", [frameAncestors]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

export type SecurityHeaderOptions = {
  host: string;
  nonce: string;
  /** Dev server: Vite's HMR/react-refresh preamble is an un-nonced inline script. */
  dev?: boolean;
};

export function securityHeaders(opts: SecurityHeaderOptions): Record<string, string> {
  const embeddable = isEmbeddableHost(opts.host);
  const headers: Record<string, string> = {
    "Strict-Transport-Security": HSTS_VALUE,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
  };
  // frame-ancestors supersedes X-Frame-Options; XFO covers older browsers.
  // There is no XFO value for "these origins", so the preview omits it.
  if (!embeddable) headers["X-Frame-Options"] = "DENY";
  if (!opts.dev) headers["Content-Security-Policy"] = buildCsp({ nonce: opts.nonce, embeddable });
  return headers;
}
