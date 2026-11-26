/**
 * Primary CTAs for Landing — focused to 3 clear high-intent actions.
 */
import { ArrowRight, Compass, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SURFACE } from "@/lib/surfaces";

export function CtaRow() {
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
      <Button asChild variant="gold" className="h-12 gap-2 px-6 text-sm font-semibold">
        <a href={SURFACE.testnet}>
          <span>Launch Testnet</span>
          <ArrowRight className="size-4" />
        </a>
      </Button>

      <Button asChild variant="outline" className="h-12 gap-2 px-6 text-sm">
        <a href={SURFACE.wallet}>
          <Wallet className="size-4 text-teal" />
          <span>Open Wallet</span>
        </a>
      </Button>

      <Button asChild variant="outline" className="h-12 gap-2 px-6 text-sm">
        <a href={SURFACE.explorer}>
          <Compass className="size-4 text-blue" />
          <span>Explore BlockDAG</span>
        </a>
      </Button>
    </div>
  );
}
