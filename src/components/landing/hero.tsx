import { KVNC_COIN_ICON } from "@/lib/tokens/icons";
import { CtaRow } from "./cta-row";
import { LiveStats } from "./live-stats";

/**
 * Apex landing hero — dark zinc + gold identity.
 * Clean visual hierarchy: brand badge → display title → plain-English value prop →
 * 3 focused CTAs → scannable spec pills → live testnet strip.
 */
export function Hero() {
  return (
    <section className="relative flex flex-col items-center overflow-hidden pt-2 text-center">
      <div
        className="pointer-events-none absolute inset-x-0 -top-24 h-80"
        style={{
          background:
            "radial-gradient(ellipse at top, rgba(242,169,0,0.12), transparent 62%)",
        }}
        aria-hidden
      />
      <div className="relative flex w-full flex-col items-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/90 px-3 py-1 font-mono text-[11px] tracking-wide text-muted">
          <img
            src={KVNC_COIN_ICON}
            alt=""
            aria-hidden="true"
            className="size-4 rounded-full object-cover"
          />
          <span>Hybrid PoW + GHOSTDAG · KVNC</span>
        </div>

        <h1 className="mt-4 font-display text-4xl tracking-tight text-fg italic md:mt-5 md:text-6xl lg:text-7xl">
          Kovanica
        </h1>
        <p className="mt-1.5 font-display text-xl tracking-tight text-gold/95 italic md:text-2xl">
          BlockDAG, wide open.
        </p>
        <p className="mx-auto mt-3.5 max-w-md text-sm leading-relaxed text-muted md:mt-4 md:max-w-lg md:text-base">
          Fast 4-second Layer-1 BlockDAG with zero stake, deterministic Wasmi smart contracts, native AMM, KVP-102 tokens &amp; NFTs, and dual-key stealth privacy.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] text-subtle">
          <span className="rounded-full border border-border/80 bg-surface px-2.5 py-0.5">
            4s BlockDAG · 100% PoW
          </span>
          <span className="rounded-full border border-border/80 bg-surface px-2.5 py-0.5">
            Zero Stake · 82M Cap
          </span>
          <span className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-gold">
            Mainnet · Jan 1, 2027
          </span>
        </div>

        <div className="mt-7 w-full max-w-md md:mt-8 md:max-w-none">
          <CtaRow />
        </div>

        <div className="mt-8 w-full max-w-lg md:mt-10 md:max-w-xl">
          <LiveStats />
        </div>
      </div>
    </section>
  );
}
