/**
 * Shell — unified protocol chrome across all app, DeFi, RWA, wallet, and info routes.
 *
 * 4-Bucket IA Navigation:
 * 1. Explore: Explorer, Network, Origins Map, Roadmap, Dashboard
 * 2. Trade & RWA: AMM Swap, AMM Pools, RWA Registry, Issue RWA, Manage RWA, Multi-Asset
 * 3. Wallet & Tools: Wallet, Ecosystem Tools, Orderbook DEX, Atomic Swaps, Airdrops, CoinJoin, Token Listings
 * 4. Contracts & Docs: Mining Pool (Stratum), Multisig, HTLC, Vaults, Stealth, Native NFTs, Docs, API Reference, Playground
 *
 * Plus:
 * - Ecosystem Switcher (consuming SURFACE / SURFACE_STATUS from surfaces.ts)
 * - Persistent Wallet & DeFi Sub-Nav Strip on /wallet*, /swap, /pools, /rwa, /multi-asset
 * - Mobile bottom bar (5 slots >= 44px) + Radix Dialog More sheet exposing all 4 buckets in <= 2 taps
 */
import { createContext, useContext, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Activity,
  ArrowLeftRight,
  Building2,
  ChevronDown,
  Code2,
  Coins,
  Compass,
  Droplets,
  ExternalLink,
  Eye,
  FileText,
  Gem,
  Globe,
  Image,
  Layers,
  LayoutDashboard,
  Lock,
  Map as MapIcon,
  Menu,
  Pickaxe,
  PlusCircle,
  Route,
  Search,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Users,
  Vault,
  Wallet,
  Waves,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceSwitch } from "@/components/layout/source-switch";
import { NetworkBadge } from "@/components/layout/network-badge";
import { getBadgeColor } from "@/lib/network";
import { SURFACE, SURFACE_STATUS } from "@/lib/surfaces";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/search/global-search";

const EXPLORE_NAV = [
  { to: "/explorer" as const, label: "Explorer", icon: Compass, desc: "Live BlockDAG & transactions" },
  { to: "/network" as const, label: "Network", icon: Activity, desc: "Peers, seeds & sync telemetry" },
  { to: "/map" as const, label: "Origins Map", icon: MapIcon, desc: "Global origin pulse choropleth" },
  { to: "/roadmap" as const, label: "Roadmap", icon: Route, desc: "Protocol milestones & RFCs" },
  { to: "/dash" as const, label: "Dashboard", icon: LayoutDashboard, desc: "Network overview dashboard" },
] as const;

const TRADE_RWA_NAV = [
  { to: "/swap" as const, label: "AMM Swap", icon: ArrowLeftRight, desc: "KVP-102 token swaps & Wave A batch" },
  { to: "/pools" as const, label: "AMM Pools", icon: Waves, desc: "DEX liquidity pools (x·y=k)" },
  { to: "/rwa" as const, label: "RWA Registry", icon: Building2, desc: "KVP-106 institutional asset explorer" },
  { to: "/wallet/rwa-issue" as const, label: "Issue RWA", icon: PlusCircle, desc: "Derive & mint KVP-106 assets" },
  { to: "/wallet/rwa-manage" as const, label: "Manage RWA", icon: Settings, desc: "Allowlist, freeze & coupon scheduler" },
  { to: "/multi-asset" as const, label: "Multi-Asset", icon: Layers, desc: "KVP-102 token balances & transfers" },
] as const;

const WALLET_TOOLS_NAV = [
  { to: "/wallet" as const, label: "Web Wallet", icon: Wallet, desc: "PRO-21 vault, hardware & sends" },
  { to: "/wallet/ecosystem-tools" as const, label: "Ecosystem Tools", icon: Wrench, desc: "Scheduler, bridge & passkeys" },
  { to: "/wallet/dex" as const, label: "Orderbook DEX", icon: ArrowLeftRight, desc: "Legacy wallet orderbook" },
  { to: "/wallet/atomic-swap" as const, label: "Atomic Swaps", icon: Sparkles, desc: "Cross-chain HTLC swaps" },
  { to: "/wallet/airdrops" as const, label: "Airdrops", icon: Coins, desc: "Batch token distribution" },
  { to: "/wallet/coinjoin" as const, label: "CoinJoin", icon: Shield, desc: "Collaborative privacy rounds" },
  { to: "/wallet/token-listings" as const, label: "Token Listings", icon: Gem, desc: "Token registry submissions" },
] as const;

const CONTRACTS_DOCS_NAV = [
  { to: "/pool" as const, label: "Mining Pool", icon: Pickaxe, desc: "Stratum V1 TLS mining pool" },
  { to: "/multisig" as const, label: "Multisig", icon: Users, desc: "M-of-N shared custody" },
  { to: "/htlc" as const, label: "HTLC", icon: Lock, desc: "Hash Time-Locked Contracts" },
  { to: "/vaults" as const, label: "Vaults", icon: Vault, desc: "Time-locked vaults (CLTV / CSV)" },
  { to: "/stealth" as const, label: "Stealth", icon: Eye, desc: "KVP-103 one-time addresses" },
  { to: "/nft" as const, label: "Native NFTs", icon: Image, desc: "KVP-106 non-fungible assets" },
  { to: "/docs" as const, label: "Docs", icon: FileText, desc: "Protocol specs & CLI cheatsheet" },
  { to: "/api-reference" as const, label: "API Reference", icon: Terminal, desc: "JSON-RPC 2.0 & HTTP contract" },
  { to: "/playground" as const, label: "Playground", icon: Code2, desc: "Onboarding, API console & snippets" },
] as const;

const WALLET_DEFI_SUBNAV = [
  { to: "/wallet" as const, label: "Wallet", icon: Wallet, exact: true },
  { to: "/swap" as const, label: "AMM Swap", icon: ArrowLeftRight, exact: false },
  { to: "/pools" as const, label: "AMM Pools", icon: Waves, exact: false },
  { to: "/rwa" as const, label: "RWA Registry", icon: Building2, exact: false },
  { to: "/wallet/rwa-issue" as const, label: "Issue RWA", icon: PlusCircle, exact: false },
  { to: "/wallet/rwa-manage" as const, label: "Manage RWA", icon: Settings, exact: false },
  { to: "/multi-asset" as const, label: "Multi-Asset", icon: Layers, exact: false },
  { to: "/wallet/ecosystem-tools" as const, label: "Ecosystem Tools", icon: Wrench, exact: false },
] as const;

const MOBILE_PRIMARY_SLOTS = [
  { to: "/explorer" as const, label: "Explorer", icon: Compass },
  { to: "/wallet" as const, label: "Wallet", icon: Wallet },
  { to: "/swap" as const, label: "Swap", icon: ArrowLeftRight },
  { to: "/faucet" as const, label: "Faucet", icon: Droplets },
] as const;

const ECOSYSTEM_SURFACES = [
  { href: SURFACE.landing, label: "Kovanica Apex", host: "kovanica.online", badge: null },
  { href: SURFACE.testnet, label: "Testnet Portal", host: "testnet.kovanica.online", badge: "Live" },
  { href: SURFACE.docs, label: "Documentation", host: "docs.kovanica.online", badge: null },
  { href: SURFACE.playground, label: "Playground", host: "playground.kovanica.online", badge: null },
  { href: SURFACE.dash, label: "Dashboard", host: "dash.kovanica.online", badge: null },
  { href: SURFACE.mainnet, label: SURFACE_STATUS.mainnet, host: "mainnet.kovanica.online", badge: "Preview" },
] as const;

function shouldShowWalletDefiSubNav(pathname: string): boolean {
  return (
    pathname === "/wallet" ||
    pathname.startsWith("/wallet/") ||
    pathname === "/swap" ||
    pathname === "/pools" ||
    pathname === "/rwa" ||
    pathname === "/multi-asset"
  );
}

const ShellContext = createContext(false);

export function Shell({ children }: { children: React.ReactNode }) {
  const insideShell = useContext(ShellContext);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  if (insideShell) {
    return <>{children}</>;
  }

  const isItemActive = (to: string, exact = false) => {
    if (to === "/" || exact) return pathname === to;
    return pathname === to || pathname.startsWith(`${to}/`);
  };

  const isTradeActive = TRADE_RWA_NAV.some((item) => isItemActive(item.to));
  const isToolsActive = WALLET_TOOLS_NAV.some((item) =>
    item.to === "/wallet" ? false : isItemActive(item.to),
  );
  const isContractsDocsActive = CONTRACTS_DOCS_NAV.some((item) => isItemActive(item.to));
  const isExploreMoreActive = EXPLORE_NAV.some((item) =>
    item.to === "/explorer" ? false : isItemActive(item.to),
  );
  const showSubNav = shouldShowWalletDefiSubNav(pathname);
  const compactHeaderSearch =
    pathname === "/swap" || pathname === "/pools" || pathname === "/rwa";

  return (
    <ShellContext.Provider value={true}>
      <div className="flex min-h-dvh flex-col overflow-x-clip bg-bg text-fg">
      <header
        className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-bg/95 px-3 backdrop-blur-sm md:h-16 md:px-5"
        style={{ borderTop: `1px solid ${getBadgeColor()}` }}
      >
        <Link to="/" className="flex min-w-0 shrink-0 items-baseline gap-2">
          <span className="font-display text-xl tracking-tight text-fg italic md:text-2xl">
            Kovanica
          </span>
          <span className="hidden font-mono text-[10px] tracking-brand text-blue uppercase 2xl:inline 2xl:text-xs">
            Protocol
          </span>
        </Link>

        {/* Primary nav: active for tablet (md) and desktop (lg/xl) */}
        <nav className="hidden items-center gap-0.5 lg:gap-1 md:flex" aria-label="Primary">
          {/* Direct 1-click core destinations */}
          <Link
            to="/explorer"
            aria-current={isItemActive("/explorer") ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-md px-2 text-xs font-medium transition-colors duration-150 lg:px-2.5 lg:text-sm",
              isItemActive("/explorer")
                ? "border-b-2 border-gold bg-surface-2 font-semibold text-fg shadow-xs"
                : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            Explorer
          </Link>
          <Link
            to="/wallet"
            aria-current={isItemActive("/wallet", true) ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-md px-2 text-xs font-medium transition-colors duration-150 lg:px-2.5 lg:text-sm",
              isItemActive("/wallet", true)
                ? "border-b-2 border-gold bg-surface-2 font-semibold text-fg shadow-xs"
                : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            Wallet
          </Link>
          <Link
            to="/faucet"
            aria-current={isItemActive("/faucet") ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-md px-2 text-xs font-medium transition-colors duration-150 lg:px-2.5 lg:text-sm",
              isItemActive("/faucet")
                ? "border-b-2 border-gold bg-surface-2 font-semibold text-fg shadow-xs"
                : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            Faucet
          </Link>

          {/* Bucket 2: Trade & RWA */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-current={isTradeActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors duration-150 outline-none lg:px-2.5 lg:text-sm",
                  isTradeActive
                    ? "border-b-2 border-gold bg-surface-2 font-semibold text-fg shadow-xs"
                    : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <span className="lg:hidden">Trade</span>
                <span className="hidden lg:inline">Trade &amp; RWA</span>
                <ChevronDown className="size-3.5 opacity-70" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={8}
                className="z-50 min-w-60 rounded-xl border border-border bg-surface p-1.5 shadow-xl focus:outline-none"
              >
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-subtle">
                  Trade &amp; RWA
                </div>
                {TRADE_RWA_NAV.map((item) => {
                  const on = isItemActive(item.to);
                  const Icon = item.icon;
                  return (
                    <DropdownMenu.Item key={item.to} asChild>
                      <Link
                        to={item.to}
                        aria-current={on ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium outline-none transition-colors",
                          on
                            ? "bg-surface-2 font-semibold text-fg"
                            : "text-muted hover:bg-surface-2 hover:text-fg",
                        )}
                      >
                        <Icon className="size-4 shrink-0 text-gold" />
                        <div className="flex flex-col">
                          <span className="text-fg">{item.label}</span>
                          <span className="text-[10px] font-normal text-muted">{item.desc}</span>
                        </div>
                      </Link>
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Bucket 3: Wallet & Tools */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-current={isToolsActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors duration-150 outline-none lg:px-2.5 lg:text-sm",
                  isToolsActive
                    ? "border-b-2 border-gold bg-surface-2 font-semibold text-fg shadow-xs"
                    : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <span>Tools</span>
                <ChevronDown className="size-3.5 opacity-70" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={8}
                className="z-50 min-w-60 rounded-xl border border-border bg-surface p-1.5 shadow-xl focus:outline-none"
              >
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-subtle">
                  Wallet &amp; Tools
                </div>
                {WALLET_TOOLS_NAV.map((item) => {
                  const on = isItemActive(item.to, item.to === "/wallet");
                  const Icon = item.icon;
                  return (
                    <DropdownMenu.Item key={item.to} asChild>
                      <Link
                        to={item.to}
                        aria-current={on ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium outline-none transition-colors",
                          on
                            ? "bg-surface-2 font-semibold text-fg"
                            : "text-muted hover:bg-surface-2 hover:text-fg",
                        )}
                      >
                        <Icon className="size-4 shrink-0 text-teal" />
                        <div className="flex flex-col">
                          <span className="text-fg">{item.label}</span>
                          <span className="text-[10px] font-normal text-muted">{item.desc}</span>
                        </div>
                      </Link>
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Bucket 4: Contracts & Docs */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-current={isContractsDocsActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors duration-150 outline-none lg:px-2.5 lg:text-sm",
                  isContractsDocsActive
                    ? "border-b-2 border-gold bg-surface-2 font-semibold text-fg shadow-xs"
                    : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <span className="2xl:hidden">Contracts</span>
                <span className="hidden 2xl:inline">Contracts &amp; Docs</span>
                <ChevronDown className="size-3.5 opacity-70" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={8}
                className="z-50 min-w-64 rounded-xl border border-border bg-surface p-1.5 shadow-xl focus:outline-none"
              >
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-subtle">
                  Contracts &amp; Docs
                </div>
                {CONTRACTS_DOCS_NAV.map((item) => {
                  const on = isItemActive(item.to);
                  const Icon = item.icon;
                  return (
                    <DropdownMenu.Item key={item.to} asChild>
                      <Link
                        to={item.to}
                        aria-current={on ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none transition-colors",
                          on
                            ? "bg-surface-2 font-semibold text-fg"
                            : "text-muted hover:bg-surface-2 hover:text-fg",
                        )}
                      >
                        <Icon className="size-4 shrink-0 text-blue" />
                        <div className="flex flex-col">
                          <span className="text-fg">{item.label}</span>
                          <span className="text-[10px] font-normal text-muted">{item.desc}</span>
                        </div>
                      </Link>
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Bucket 1 overflow: Explore / Network */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-current={isExploreMoreActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors duration-150 outline-none lg:px-2.5 lg:text-sm",
                  isExploreMoreActive
                    ? "border-b-2 border-gold bg-surface-2 font-semibold text-fg shadow-xs"
                    : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <span>Network</span>
                <ChevronDown className="size-3.5 opacity-70" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={8}
                className="z-50 min-w-56 rounded-xl border border-border bg-surface p-1.5 shadow-xl focus:outline-none"
              >
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-subtle">
                  Explore &amp; Network
                </div>
                {EXPLORE_NAV.map((item) => {
                  const on = isItemActive(item.to);
                  const Icon = item.icon;
                  return (
                    <DropdownMenu.Item key={item.to} asChild>
                      <Link
                        to={item.to}
                        aria-current={on ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium outline-none transition-colors",
                          on
                            ? "bg-surface-2 font-semibold text-fg"
                            : "text-muted hover:bg-surface-2 hover:text-fg",
                        )}
                      >
                        <Icon className="size-4 shrink-0 text-blue" />
                        <div className="flex flex-col">
                          <span className="text-fg">{item.label}</span>
                          <span className="text-[10px] font-normal text-muted">{item.desc}</span>
                        </div>
                      </Link>
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </nav>

        {/* Top Navbar Global Search */}
        {!compactHeaderSearch && (
          <div className="hidden lg:flex w-36 xl:w-44 shrink-0 mx-1">
            <GlobalSearch variant="navbar" />
          </div>
        )}

        {/* Header right: Ecosystem switcher, Network badge & source switch */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMobileSearchOpen((o) => !o)}
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-md border border-border",
              compactHeaderSearch ? "" : "lg:hidden",
              mobileSearchOpen
                ? "text-gold bg-surface-2 border-gold/40"
                : "text-muted hover:text-fg hover:bg-surface-2",
            )}
            aria-label="Toggle search bar"
          >
            <Search className="size-4" />
          </button>

          {/* Ecosystem Switcher */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="Ecosystem surfaces"
                className="hidden md:inline-flex h-9 items-center gap-1 rounded-md border border-border bg-surface/80 px-2 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg outline-none"
              >
                <Globe className="size-3.5 text-gold" />
                <span className="hidden 2xl:inline">Ecosystem</span>
                <ChevronDown className="size-3 opacity-70" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={8}
                className="z-50 min-w-60 rounded-xl border border-border bg-surface p-1.5 shadow-xl focus:outline-none"
              >
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-subtle">
                  Kovanica Ecosystem
                </div>
                {ECOSYSTEM_SURFACES.map((surf) => (
                  <DropdownMenu.Item key={surf.href} asChild>
                    <a
                      href={surf.href}
                      className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-xs text-muted outline-none transition-colors hover:bg-surface-2 hover:text-fg"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-fg">{surf.label}</span>
                        <span className="font-mono text-[10px] text-subtle">{surf.host}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {surf.badge && (
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 font-mono text-[9px] uppercase",
                              surf.badge === "Live"
                                ? "bg-teal/15 text-teal"
                                : "bg-gold/15 text-gold",
                            )}
                          >
                            {surf.badge}
                          </span>
                        )}
                        <ExternalLink className="size-3 shrink-0 opacity-60" />
                      </div>
                    </a>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <span className="hidden xl:inline-flex">
            <NetworkBadge />
          </span>
          <span className="xl:hidden">
            <SourceSwitch compact />
          </span>
          <span className="hidden xl:inline-flex">
            <SourceSwitch />
          </span>
          <Link
            to="/docs"
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-md md:hidden",
              isItemActive("/docs") ? "text-fg" : "text-muted",
            )}
            aria-label="Docs"
          >
            <FileText className="size-4" />
          </Link>
        </div>
      </header>

      {/* Mobile / tablet / compact search bar dropdown */}
      {mobileSearchOpen && (
        <div className={cn("border-b border-border bg-bg/95 p-3 backdrop-blur-sm animate-in fade-in slide-in-from-top-2", compactHeaderSearch ? "" : "lg:hidden")}>
          <GlobalSearch variant="navbar" onResolved={() => setMobileSearchOpen(false)} />
        </div>
      )}

      {/* Persistent Wallet & DeFi sub-nav strip */}
      {showSubNav && (
        <nav
          aria-label="Wallet and DeFi navigation"
          className="border-b border-border bg-surface/70 px-3 py-1.5 backdrop-blur-sm md:px-6"
        >
          <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto no-scrollbar">
            {WALLET_DEFI_SUBNAV.map((item) => {
              const Icon = item.icon;
              const on = isItemActive(item.to, item.exact);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                    on
                      ? "bg-surface-2 text-gold border border-gold/30"
                      : "text-muted hover:bg-surface-2 hover:text-fg border border-transparent",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      <div className="flex min-h-0 flex-1 flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </div>

      {/* Mobile bottom navigation: exactly 5 slots (>=44px touch targets) with accessible More sheet */}
      <nav
        aria-label="Mobile"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
      >
        <ul className="grid grid-cols-5">
          {MOBILE_PRIMARY_SLOTS.map((item) => {
            const Icon = item.icon;
            const on = isItemActive(item.to, item.to === "/wallet");
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-medium leading-tight",
                    on ? "font-semibold text-fg" : "text-muted",
                  )}
                >
                  <Icon className="size-5 shrink-0" strokeWidth={on ? 2.2 : 1.8} />
                  <span className="truncate max-w-full">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  aria-expanded={mobileOpen}
                  aria-label="More navigation options"
                  className={cn(
                    "flex h-full w-full min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-medium leading-tight",
                    isContractsDocsActive || isTradeActive || isToolsActive || isExploreMoreActive || pathname === "/"
                      ? "font-semibold text-fg"
                      : "text-muted",
                  )}
                >
                  <Menu
                    className="size-5 shrink-0"
                    strokeWidth={isContractsDocsActive || isTradeActive ? 2.2 : 1.8}
                  />
                  <span className="truncate max-w-full">More</span>
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs animate-in fade-in" />
                <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-5 shadow-2xl focus:outline-none">
                  <div className="flex items-center justify-between border-b border-border pb-3">
                    <Dialog.Title className="font-display text-lg tracking-tight text-fg italic">
                      Kovanica Navigation
                    </Dialog.Title>
                    <Dialog.Close asChild>
                      <Button variant="ghost" size="icon" aria-label="Close navigation sheet">
                        <X className="size-4" />
                      </Button>
                    </Dialog.Close>
                  </div>

                  {/* Search in mobile sheet */}
                  <div className="mt-3">
                    <GlobalSearch variant="navbar" onResolved={() => setMobileOpen(false)} />
                  </div>

                  {/* Bucket 2: Trade & RWA */}
                  <div className="mt-4">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-subtle">
                      Trade &amp; RWA
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {TRADE_RWA_NAV.map((item) => {
                        const Icon = item.icon;
                        const on = isItemActive(item.to);
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            onClick={() => setMobileOpen(false)}
                            aria-current={on ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border border-border/60 bg-bg/50 p-2.5 text-xs font-medium transition-colors",
                              on ? "border-gold/50 bg-surface-2 text-fg" : "text-muted hover:text-fg",
                            )}
                          >
                            <Icon className="size-4 shrink-0 text-gold" />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bucket 3: Wallet & Tools */}
                  <div className="mt-4">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-subtle">
                      Wallet &amp; Tools
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {WALLET_TOOLS_NAV.map((item) => {
                        const Icon = item.icon;
                        const on = isItemActive(item.to, item.to === "/wallet");
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            onClick={() => setMobileOpen(false)}
                            aria-current={on ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border border-border/60 bg-bg/50 p-2.5 text-xs font-medium transition-colors",
                              on ? "border-gold/50 bg-surface-2 text-fg" : "text-muted hover:text-fg",
                            )}
                          >
                            <Icon className="size-4 shrink-0 text-teal" />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bucket 4: Contracts & Docs */}
                  <div className="mt-4">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-subtle">
                      Contracts &amp; Docs
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {CONTRACTS_DOCS_NAV.map((item) => {
                        const Icon = item.icon;
                        const on = isItemActive(item.to);
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            onClick={() => setMobileOpen(false)}
                            aria-current={on ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border border-border/60 bg-bg/50 p-2.5 text-xs font-medium transition-colors",
                              on ? "border-gold/50 bg-surface-2 text-fg" : "text-muted hover:text-fg",
                            )}
                          >
                            <Icon className="size-4 shrink-0 text-blue" />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bucket 1: Explore */}
                  <div className="mt-4">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-subtle">
                      Explore
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      <Link
                        to="/"
                        onClick={() => setMobileOpen(false)}
                        aria-current={pathname === "/" ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border border-border/60 bg-bg/50 p-2.5 text-xs font-medium transition-colors",
                          pathname === "/" ? "border-gold/50 bg-surface-2 text-fg" : "text-muted hover:text-fg",
                        )}
                      >
                        <Coins className="size-4 shrink-0 text-gold" />
                        <span>Home</span>
                      </Link>
                      {EXPLORE_NAV.map((item) => {
                        const Icon = item.icon;
                        const on = isItemActive(item.to);
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            onClick={() => setMobileOpen(false)}
                            aria-current={on ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border border-border/60 bg-bg/50 p-2.5 text-xs font-medium transition-colors",
                              on ? "border-gold/50 bg-surface-2 text-fg" : "text-muted hover:text-fg",
                            )}
                          >
                            <Icon className="size-4 shrink-0 text-blue" />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>

                  {/* Ecosystem Switcher */}
                  <div className="mt-4">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-subtle">
                      Ecosystem Surfaces
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {ECOSYSTEM_SURFACES.map((surf) => (
                        <a
                          key={surf.href}
                          href={surf.href}
                          onClick={() => setMobileOpen(false)}
                          className="flex items-center justify-between gap-1 rounded-lg border border-border/60 bg-bg/50 p-2.5 text-xs text-muted transition-colors hover:text-fg"
                        >
                          <span className="truncate font-medium text-fg">{surf.label}</span>
                          <ExternalLink className="size-3 shrink-0 opacity-60" />
                        </a>
                      ))}
                    </div>
                  </div>

                  {/* Mobile Network info / source switch */}
                  <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                    <NetworkBadge />
                    <SourceSwitch />
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </li>
        </ul>
      </nav>
      </div>
    </ShellContext.Provider>
  );
}
