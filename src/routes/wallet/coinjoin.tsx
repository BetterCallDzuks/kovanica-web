import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { RouteLoading } from "@/components/layout/route-loading";
import { RouteError } from "@/components/layout/route-error";

const LazyCoinJoinView = lazyRouteComponent(
  () => import("@/components/wallet/coinjoin-view"),
  "CoinJoinView",
);

export const Route = createFileRoute("/wallet/coinjoin")({
  component: CoinJoinPage,
  pendingComponent: () => <RouteLoading message="Loading CoinJoin..." />,
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} reset={reset} title="CoinJoin unavailable" />
  ),
});

function CoinJoinPage() {
  return <LazyCoinJoinView />;
}
