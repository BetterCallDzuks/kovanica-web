import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/layout/shell";
import { MultisigView } from "@/components/wallet/multisig-view";
import { AirgapQuorumInspector } from "@/components/multisig/airgap-quorum-inspector";

export const Route = createFileRoute("/multisig")({ component: MultisigPage });

function MultisigPage() {
  return (
    <Shell>
      <MultisigView />
      <div className="mx-auto w-full max-w-2xl px-4 pb-10 md:px-6">
        <AirgapQuorumInspector />
      </div>
    </Shell>
  );
}
