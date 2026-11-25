import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { NftView } from "@/components/protocol/nft-view";

export const Route = createFileRoute("/nft")({
  component: NftPage,
});

function NftPage() {
  return (
    <Shell>
      <NftView />
    </Shell>
  );
}
