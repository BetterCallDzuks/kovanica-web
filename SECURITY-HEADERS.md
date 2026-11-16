# Security headers

The app sets these on every response, for every host role in `src/lib/host.ts`
(`src/start.ts` → `src/lib/security-headers.ts`):

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | per-request nonce for scripts, `'wasm-unsafe-eval'` for the SDK wasm, `frame-ancestors 'none'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (no preload) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | sensors, camera, mic, geolocation, payment, topics off; `usb` for self + Trezor Connect; `clipboard-write` for self |

Only the live preview guest (`*.grok-sandbox.com`) may be framed, by Grok
origins; it gets no `X-Frame-Options`. The dev server sends no CSP because
Vite's HMR preamble is an inline script without a nonce.

## What the edge (nginx / Cloudflare) must do

TanStack Start SSR emits inline bootstrap and hydration scripts whose content
changes per request, so the CSP has to carry the app's nonce. Browsers enforce
**every** CSP they receive, so a second policy added at the edge without that
nonce blocks hydration again and the page renders blank. As of 2026-11-16,
`mainnet.kovanica.online` and `dash.kovanica.online` responses carry an
edge-added CSP, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options`,
`Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy:
require-corp` and `Cross-Origin-Resource-Policy` that the app does not set.

For every vhost proxied to this app:

- Remove `add_header Content-Security-Policy …` (or the matching Cloudflare
  response-header rule). The app's policy is the only one.
- Remove `add_header X-Frame-Options …`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Strict-Transport-Security` and `Permissions-Policy`, or
  keep values identical to the table above. Duplicate `X-Frame-Options` with
  different values is treated inconsistently by browsers.
- Re-check `Cross-Origin-Embedder-Policy: require-corp`: it blocks cross-origin
  subresources without CORP/CORS (Google Fonts, IPFS gateways, Trezor Connect).
  The app does not need cross-origin isolation.
- Static files the app serves (`/assets/*`, `public/*`) get HSTS and `nosniff`
  from Nitro `routeRules` in `vite.config.ts`. If nginx serves them from disk
  instead, add those two headers there.
