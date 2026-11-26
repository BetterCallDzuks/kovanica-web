import { NetworkBadge } from "@/components/layout/network-badge";
import { SURFACE } from "@/lib/surfaces";
import { KVNC_COIN_ICON } from "@/lib/tokens/icons";

/**
 * Apex (kovanica.online) chrome — wordmark + clean nav + gold Testnet CTA.
 * No Explorer/Wallet/Faucet strip: those live on testnet.* hosts.
 * CTAs on the landing page use absolute SURFACE.* URLs.
 */
export function LandingChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header
        className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 backdrop-blur-sm md:h-16 md:px-6"
        style={{ borderTop: "1px solid #F2A900" }}
      >
        <a href={SURFACE.landing} className="flex min-w-0 items-center gap-2.5">
          <img
            src={KVNC_COIN_ICON}
            alt=""
            aria-hidden="true"
            className="size-6 rounded-full object-cover ring-1 ring-gold/30"
          />
          <span className="flex items-baseline gap-2">
            <span className="font-display text-xl tracking-tight text-fg italic md:text-2xl">
              Kovanica
            </span>
            <span className="font-mono text-[10px] tracking-brand text-blue uppercase md:text-xs">
              Protocol
            </span>
          </span>
        </a>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Landing">
          <a
            href={SURFACE.docs}
            className="inline-flex h-9 items-center rounded-md px-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:px-2.5"
          >
            Docs
          </a>
          <a
            href={`${SURFACE.landing}/roadmap`}
            className="inline-flex h-9 items-center rounded-md px-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:px-2.5"
          >
            Roadmap
          </a>
          <a
            href={`${SURFACE.testnet}/pricing`}
            className="hidden h-9 items-center rounded-md px-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg md:inline-flex"
          >
            Pricing
          </a>
          <a
            href={SURFACE.github}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-9 items-center rounded-md px-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:inline-flex"
          >
            GitHub
          </a>
          <a
            href={SURFACE.testnet}
            className="ml-1 inline-flex h-9 items-center rounded-lg bg-gold px-3.5 text-sm font-semibold text-accent-fg transition-colors hover:bg-gold-dark"
          >
            Open Testnet
          </a>
          <span className="hidden lg:inline-flex">
            <NetworkBadge />
          </span>
        </nav>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <footer className="border-t border-border px-4 py-6 md:px-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 text-xs text-subtle md:flex-row">
          <span className="font-mono">kovanica · KVNC · Hybrid PoW + GHOSTDAG</span>
          <div className="flex flex-wrap items-center gap-4 font-mono">
            <a
              href={`${SURFACE.landing}/privacy`}
              className="transition-colors hover:text-fg"
            >
              Privacy
            </a>
            <a
              href="https://x.com/KovanicaDAG"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-fg"
            >
              @KovanicaDAG
            </a>
            <a
              href="https://x.com/BetterCallDzuks"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-fg"
            >
              @BetterCallDzuks
            </a>
            <a
              href={SURFACE.github}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-fg"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
