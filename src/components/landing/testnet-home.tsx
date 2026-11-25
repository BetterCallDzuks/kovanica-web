/**
 * HomeTestnet — app home for testnet.kovanica.online (and shared protocol hosts).
 * Categorized quick-launch grid surfacing Explore, DeFi & RWA, Wallet & Tools,
 * and Contracts in 1 click.
 */
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeftRight,
  Building2,
  Compass,
  Droplets,
  FileText,
  Layers,
  LayoutDashboard,
  Lock,
  Map,
  Pickaxe,
  PlusCircle,
  Settings,
  Users,
  Vault,
  Wallet,
  Waves,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { WalletDownloads } from "@/components/wallet/wallet-downloads";
import { useLedger } from "@/lib/ledger/store";
import { useHydrated } from "@/lib/use-hydrated";
import { LiveStats } from "./live-stats";

const QUICK_GROUPS = [
  {
    title: "DeFi & RWA",
    accent: "text-gold",
    items: [
      { to: "/swap" as const, label: "AMM Swap", desc: "KVP-102 token swaps", icon: ArrowLeftRight },
      { to: "/pools" as const, label: "AMM Pools", desc: "DEX liquidity (x·y=k)", icon: Waves },
      { to: "/rwa" as const, label: "RWA Registry", desc: "KVP-106 asset directory", icon: Building2 },
      { to: "/wallet/rwa-issue" as const, label: "Issue RWA", desc: "Derive & mint assets", icon: PlusCircle },
      { to: "/wallet/rwa-manage" as const, label: "Manage RWA", desc: "Allowlist & coupons", icon: Settings },
      { to: "/multi-asset" as const, label: "Multi-Asset", desc: "Token UTXOs & sends", icon: Layers },
    ],
  },
  {
    title: "Wallet, Faucet & Tools",
    accent: "text-teal",
    items: [
      { to: "/wallet" as const, label: "Web Wallet", desc: "PRO-21 vault & sends", icon: Wallet },
      { to: "/wallet/ecosystem-tools" as const, label: "Ecosystem Tools", desc: "Scheduler, bridge & passkeys", icon: Wrench },
      { to: "/faucet" as const, label: "Faucet", desc: "Claim testnet KVNC", icon: Droplets },
      { to: "/docs" as const, label: "Docs", desc: "Specs & CLI reference", icon: FileText },
    ],
  },
  {
    title: "Explore & Contracts",
    accent: "text-blue",
    items: [
      { to: "/explorer" as const, label: "Explorer", desc: "Live BlockDAG & txs", icon: Compass },
      { to: "/network" as const, label: "Network", desc: "Peers & sync status", icon: Activity },
      { to: "/pool" as const, label: "Mining Pool", desc: "Stratum V1 TLS mining", icon: Pickaxe },
      { to: "/multisig" as const, label: "Multisig", desc: "M-of-N shared custody", icon: Users },
      { to: "/htlc" as const, label: "HTLC", desc: "Atomic swap contracts", icon: Lock },
      { to: "/vaults" as const, label: "Vaults", desc: "CLTV / CSV time-locks", icon: Vault },
      { to: "/map" as const, label: "Origins Map", desc: "Global origin pulses", icon: Map },
      { to: "/dash" as const, label: "Dashboard", desc: "Network overview", icon: LayoutDashboard },
    ],
  },
] as const;

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
          <Link to="/explorer">Open explorer</Link>
        </Button>
        <Button asChild variant="outline" className="h-10 px-5">
          <Link to="/wallet">Open wallet</Link>
        </Button>
        <Button asChild variant="outline" className="h-10 px-5">
          <Link to="/swap">Swap &amp; DeFi</Link>
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

        {QUICK_GROUPS.map((group) => (
          <div key={group.title} className="space-y-2.5">
            <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted">
              {group.title}
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
