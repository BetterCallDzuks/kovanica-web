import {
  createFileRoute,
  lazyRouteComponent,
  Link,
  Outlet,
  useLocation,
  useMatches,
} from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Shell } from "@/components/layout/shell";
import { RouteLoading } from "@/components/layout/route-loading";
import { RouteError } from "@/components/layout/route-error";

const LazyExplorerView = lazyRouteComponent(
  () => import("@/components/explorer/explorer-view"),
  "ExplorerView",
);

export const Route = createFileRoute("/explorer")({
  component: ExplorerPage,
  pendingComponent: () => (
    <Shell>
      <RouteLoading message="Loading BlockDAG Explorer..." />
    </Shell>
  ),
  notFoundComponent: ExplorerNotFound,
  errorComponent: ({ error, reset }) => (
    <Shell>
      <RouteError error={error} reset={reset} title="Explorer unavailable" />
    </Shell>
  ),
});

function ExplorerPage() {
  const matches = useMatches();
  const { pathname } = useLocation();
  const isExact = matches[matches.length - 1]?.routeId === Route.id;
  // An unmatched `/explorer/*` path (fuzzy not-found) also lands here as the
  // last match; its <Outlet /> renders ExplorerNotFound with HTTP 404.
  const isExplorerRoot = pathname.replace(/\/+$/, "") === "/explorer";
  if (!isExact || !isExplorerRoot) {
    return <Outlet />;
  }
  return (
    <Shell>
      <LazyExplorerView />
    </Shell>
  );
}

const LOOKUP_NOUN: Record<string, string> = {
  block: "block",
  blocks: "block",
  tx: "transaction",
  txs: "transaction",
  transaction: "transaction",
  address: "address",
  addr: "address",
};

/**
 * HTTP 404 for any unknown `/explorer/*` path, including block / tx / address
 * ids. seed1 exposes no per-id block, transaction or address lookup, so these
 * never resolve; say so instead of rendering the explorer under a 404.
 */
function ExplorerNotFound() {
  const { pathname } = useLocation();
  const [, , kind = "", ...rest] = pathname.split("/");
  const noun = LOOKUP_NOUN[kind.toLowerCase()];
  const id = rest.join("/");
  return (
    <Shell>
      <div className="mx-auto flex min-h-[40vh] max-w-md flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
          <SearchX className="size-6" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="font-display text-lg font-medium text-fg">
            {noun ? `${noun[0]!.toUpperCase()}${noun.slice(1)} not found` : "Not found"}
          </h2>
          <p className="font-mono text-xs text-muted break-words">
            {noun && id
              ? `No ${noun} “${decodeSafe(id)}” was found on this network. The explorer does not serve per-ID ${noun} lookups yet.`
              : "This explorer page does not exist."}
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="mt-2">
          <Link to="/explorer">Back to Explorer</Link>
        </Button>
      </div>
    </Shell>
  );
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
