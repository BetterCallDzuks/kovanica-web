import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { StealthView } from "@/components/protocol/stealth-view";

export const Route = createFileRoute("/stealth")({
  component: StealthPage,
});

function StealthPage() {
  return (
    <Shell>
      <StealthView />
    </Shell>
  );
}
