import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent, AppNotFoundComponent } from "@/lib/error-component";
import { requestNonce } from "@/lib/response-status";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    defaultNotFoundComponent: AppNotFoundComponent,
    // Per-request CSP nonce (src/start.ts) stamped on every SSR script/style.
    ssr: { nonce: requestNonce() },
  });
}
