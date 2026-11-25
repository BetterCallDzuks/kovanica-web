import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { RouteLoading } from "@/components/layout/route-loading";
import { RouteError } from "@/components/layout/route-error";

const LazyAtomicSwapView = lazyRouteComponent(
  () => import("@/components/wallet/atomic-swap-view"),
  "AtomicSwapView",
);

export const Route = createFileRoute("/wallet/atomic-swap")({
  component: AtomicSwapPage,
  pendingComponent: () => <RouteLoading message="Loading Atomic Swaps..." />,
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} reset={reset} title="Atomic Swaps unavailable" />
  ),
});

function AtomicSwapPage() {
  return <LazyAtomicSwapView />;
}
