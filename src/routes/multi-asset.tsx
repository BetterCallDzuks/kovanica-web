import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { MultiAssetView } from "@/components/protocol/multi-asset-view";

export const Route = createFileRoute("/multi-asset")({
  component: MultiAssetPage,
});

function MultiAssetPage() {
  return (
    <Shell>
      <MultiAssetView />
    </Shell>
  );
}
