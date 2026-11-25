/**
 * HomeTestnet — app home for testnet.kovanica.online (and shared protocol hosts).
 * Shares the canonical 5-tab NAV_GROUPS (Explore · Trade · Assets · Wallet · Build)
 * from Shell so labels and functional groupings are 100% consistent everywhere.
 */
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { NAV_GROUPS } from "@/components/layout/shell";
import { WalletDownloads } from "@/components/wallet/wallet-downloads";
import { useLedger } from "@/lib/ledger/store";
import { useHydrated } from "@/lib/use-hydrated";
import { LiveStats } from "./live-stats";

export function HomeTestnet() {
  const hydrated = useHydrated();
  const walletStore = useLedger((s) => s.wallet);
  const wallet = hydrated ? walletStore : null;

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-12 pt-6 md:px-8 md:pt-10">
      <p className="text-center font-mono text-[11px] tracking-brand text-muted uppercase">
        testnet · KVNC
      </p>
      <h1 className="mt-2 text-center font-display text-3xl tracking-tight text-fg italic md:text-5xl">
        Testnet
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-center text-sm leading-relaxed text-muted">
        kovanica-testnet (chain ID 2). Hybrid PoW + GHOSTDAG. Explorer, wallet, AMM DEX, KVP-106 RWA registry, faucet, and smart contracts.
      </p>

      <div className="mt-6 w-full max-w-xl self-center">
        <LiveStats />
      </div>

      <div className="mt-5 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row sm:items-center sm:justify-center">
        <Button asChild variant="gold" className="h-10 px-5">
          <Link to="/explorer">Explorer</Link>
        </Button>
        <Button asChild variant="outline" className="h-10 px-5">
          <Link to="/swap">Swap</Link>
        </Button>
        <Button asChild variant="outline" className="h-10 px-5">
          <Link to="/rwa">RWA Registry</Link>
        </Button>
        <Button asChild variant="outline" className="h-10 px-5">
          <Link to="/wallet">Wallet</Link>
        </Button>
        <Button asChild variant="outline" className="h-10 px-5">
          <Link to="/faucet">Faucet</Link>
        </Button>
      </div>

      {!wallet && (
        <p className="mt-4 text-center text-xs text-subtle">
          Create a wallet to claim faucet funds on this network.
        </p>
      )}

      <section className="mt-8 space-y-6" aria-labelledby="quick-heading">
        <div className="flex items-baseline justify-between">
          <h2
            id="quick-heading"
            className="font-display text-xl tracking-tight text-fg md:text-2xl"
          >
            Open a surface
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-wider text-subtle">
            1-click launch
          </span>
        </div>

        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="space-y-2.5">
            <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted">
              {group.label}
            </h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className="flex h-full items-start gap-2.5 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-gold/40 hover:bg-surface-2"
                    >
                      <Icon className={`mt-0.5 size-4 shrink-0 ${group.accent}`} />
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-medium text-fg">
                          {item.label}
                        </span>
                        <span className="block truncate text-[11px] text-muted">
                          {item.desc}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <WalletDownloads className="mt-8" variant="strip" />
    </main>
  );
}
