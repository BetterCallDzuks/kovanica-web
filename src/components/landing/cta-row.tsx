/**
 * Primary CTAs for Landing.
 * Green / primary → Testnet.
 * Mainnet stays soft “soon”.
 */
import { Button } from "@/components/ui/button";
import { SURFACE } from "@/lib/surfaces";

export function CtaRow() {
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
      <Button asChild variant="gold" className="h-12 px-6">
        <a href={SURFACE.testnet}>Open Testnet</a>
      </Button>

      <Button asChild variant="outline" className="h-12 px-6">
        <a href={SURFACE.explorer}>Explorer</a>
      </Button>

      <Button asChild variant="outline" className="h-12 px-6">
        <a href={SURFACE.wallet}>Wallet</a>
      </Button>

      <Button asChild variant="ghost" className="h-12 px-6">
        <a href={SURFACE.docs}>Docs</a>
      </Button>

      <Button asChild variant="ghost" className="h-12 px-6">
        <a href={SURFACE.github} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </Button>

      {/* Mainnet gate — keep soft until live */}
      <Button
        variant="ghost"
        className="h-12 px-6 text-subtle"
        disabled
        title="Public launch: 1.1.2027"
      >
        Mainnet · 1.1.2027
      </Button>
    </div>
  );
}
