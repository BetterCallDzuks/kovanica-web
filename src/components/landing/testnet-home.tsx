/**
 * HomeTestnet — clean, guided app home for testnet.kovanica.online.
 * Shares the canonical 5-tab NAV_GROUPS (Explore · Trade · Assets · Wallet · Build)
 * from Shell so labels and functional groupings are 100% consistent everywhere.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Droplets, Compass, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NAV_GROUPS } from "@/components/layout/shell";
import { WalletDownloads } from "@/components/wallet/wallet-downloads";
import { useLedger } from "@/lib/ledger/store";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import { LiveStats } from "./live-stats";

type SurfaceFilter = "popular" | (typeof NAV_GROUPS)[number]["id"] | "all";

const POPULAR_ROUTES = new Set<string>([
  "/explorer",
  "/wallet",
  "/faucet",
  "/swap",
  "/pools",
  "/stealth",
]);

export function HomeTestnet() {
  const hydrated = useHydrated();
  const walletStore = useLedger((s) => s.wallet);
  const wallet = hydrated ? walletStore : null;
  const [filter, setFilter] = useState<SurfaceFilter>("popular");

  const popularItems = NAV_GROUPS.flatMap((group) =>
    group.items
      .filter((item) => POPULAR_ROUTES.has(item.to))
      .map((item) => ({ ...item, accent: group.accent })),
  );

  const visibleGroups =
    filter === "all"
      ? NAV_GROUPS
      : filter === "popular"
        ? []
        : NAV_GROUPS.filter((group) => group.id === filter);

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-12 pt-6 md:px-8 md:pt-10">
      <p className="text-center font-mono text-[11px] tracking-brand text-muted uppercase">
        testnet · chain ID 2 · KVNC
      </p>
      <h1 className="mt-2 text-center font-display text-3xl tracking-tight text-fg italic md:text-5xl">
        Kovanica Testnet
      </h1>
      <p className="mx-auto mt-2.5 max-w-lg text-center text-sm leading-relaxed text-muted">
        Explore the live BlockDAG, claim free testnet KVNC, swap on the native AMM, or try KVP-103 stealth addresses.
      </p>

      <div className="mt-6 w-full max-w-xl self-center">
        <LiveStats />
      </div>

      {/* Guided 3-step Quick Start for new visitors */}
      {!wallet ? (
        <section
          aria-label="Quick start"
          className="mt-6 rounded-2xl border border-gold/25 bg-surface p-4 md:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-gold">
              Get started in 30 seconds
            </span>
            <span className="text-xs text-muted">Free testnet funds · zero custody</span>
          </div>
          <ol className="mt-3 grid gap-2.5 sm:grid-cols-3">
            <li>
              <Link
                to="/wallet"
                className="group flex h-full items-center gap-3 rounded-xl border border-border bg-surface-2/70 p-3 transition-colors hover:border-gold/50 hover:bg-surface-2"
              >
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-gold font-mono text-xs font-bold text-accent-fg">
                  1
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                    <Wallet className="size-3.5 text-teal" />
                    <span>Create Wallet</span>
                  </div>
                  <p className="text-[11px] text-muted">Generate a local BIP-44 address</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-subtle group-hover:text-gold" />
              </Link>
            </li>
            <li>
              <Link
                to="/faucet"
                className="group flex h-full items-center gap-3 rounded-xl border border-border bg-surface-2/70 p-3 transition-colors hover:border-gold/50 hover:bg-surface-2"
              >
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-mono text-xs font-semibold text-fg">
                  2
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                    <Droplets className="size-3.5 text-blue" />
                    <span>Claim Testnet KVNC</span>
                  </div>
                  <p className="text-[11px] text-muted">Instant faucet drip for fees & swaps</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-subtle group-hover:text-gold" />
              </Link>
            </li>
            <li>
              <Link
                to="/swap"
                className="group flex h-full items-center gap-3 rounded-xl border border-border bg-surface-2/70 p-3 transition-colors hover:border-gold/50 hover:bg-surface-2"
              >
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-mono text-xs font-semibold text-fg">
                  3
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                    <Compass className="size-3.5 text-gold" />
                    <span>Swap or Explore</span>
                  </div>
                  <p className="text-[11px] text-muted">Trade AMM pools or watch the DAG</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-subtle group-hover:text-gold" />
              </Link>
            </li>
          </ol>
        </section>
      ) : (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-teal/35 bg-teal/10 px-3 py-1 font-mono text-[11px] text-teal">
            <CheckCircle2 className="size-3.5" />
            <span>Wallet connected</span>
          </span>
          <Button asChild variant="gold" className="h-9 px-4 text-xs font-semibold">
            <Link to="/explorer">Explorer</Link>
          </Button>
          <Button asChild variant="outline" className="h-9 px-4 text-xs">
            <Link to="/swap">Swap</Link>
          </Button>
          <Button asChild variant="outline" className="h-9 px-4 text-xs">
            <Link to="/wallet">Wallet</Link>
          </Button>
          <Button asChild variant="outline" className="h-9 px-4 text-xs">
            <Link to="/faucet">Faucet</Link>
          </Button>
        </div>
      )}

      {/* Clean tabbed surface directory (defaults to 6 Popular essentials) */}
      <section className="mt-8 space-y-5" aria-labelledby="quick-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2
            id="quick-heading"
            className="font-display text-xl tracking-tight text-fg md:text-2xl"
          >
            Open a surface
          </h2>
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="tablist"
            aria-label="Filter surfaces"
          >
            {(
              [
                { id: "popular", label: "Popular" },
                ...NAV_GROUPS.map((g) => ({ id: g.id, label: g.label })),
                { id: "all", label: "All" },
              ] as const
            ).map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(tab.id)}
                  className={cn(
                    "rounded-full border px-3 py-1 font-mono text-[11px] transition-colors",
                    active
                      ? "border-gold bg-gold font-semibold text-accent-fg"
                      : "border-border bg-surface text-muted hover:border-border/80 hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {filter === "popular" ? (
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {popularItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="flex h-full items-start gap-3 rounded-xl border border-border bg-surface p-3.5 transition-colors hover:border-gold/40 hover:bg-surface-2"
                  >
                    <Icon className={`mt-0.5 size-4 shrink-0 ${item.accent}`} />
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">
                        {item.label}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {item.desc}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          visibleGroups.map((group) => (
            <div key={group.id} className="space-y-2.5">
              {filter === "all" && (
                <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted">
                  {group.label}
                </h3>
              )}
              <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
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
          ))
        )}
      </section>

      <WalletDownloads className="mt-8" variant="strip" />
    </main>
  );
}
