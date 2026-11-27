/**
 * Shell — unified protocol chrome across all app, DeFi, wallet, and info routes.
 *
 * 5-Tab Function Navigation (single source of truth shared with HomeTestnet):
 * 1. Explore: Explorer, Network, Mining Pool, Origins Map, Dashboard, Roadmap
 * 2. Trade: Swap, Liquidity Pools, Orderbook DEX, Atomic Swaps
 * 3. Assets: Multi-Asset, Native NFTs, Token Listings
 * 4. Wallet: Wallet, Faucet, Airdrops, CoinJoin, Ecosystem Tools
 * 5. Build: Multisig, HTLC, Vaults, Stealth, Docs, API Reference, Playground, Support & Donations, Privacy Policy
 *
 * Plus:
 * - Ecosystem Switcher (consuming SURFACE / SURFACE_STATUS from surfaces.ts)
 * - Contextual section sub-nav strip on Trade, Assets, and Wallet routes
 * - Mobile bottom bar (5 slots >= 44px) + Radix Dialog More sheet exposing all 5 groups in <= 2 taps
 */
import { createContext, useContext, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Activity,
  ArrowLeftRight,
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
  Heart,
  Image,
  Layers,
  LayoutDashboard,
  Lock,
  Map as MapIcon,
  Menu,
  Pickaxe,
  Route,
  Search,
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
import { KVNC_COIN_ICON } from "@/lib/tokens/icons";

export const NAV_GROUPS = [
  {
    id: "explore",
    label: "Explore",
    accent: "text-blue",
    showSubNav: false,
    extraPrefixes: [] as readonly string[],
    items: [
      { to: "/explorer" as const, label: "Explorer", icon: Compass, desc: "Live BlockDAG & transactions", exact: false },
      { to: "/network" as const, label: "Network", icon: Activity, desc: "Peers, seeds & sync telemetry", exact: false },
      { to: "/pool" as const, label: "Mining Pool", icon: Pickaxe, desc: "Stratum V1 TLS mining pool", exact: false },
      { to: "/map" as const, label: "Origins Map", icon: MapIcon, desc: "Global origin pulse choropleth", exact: false },
      { to: "/dash" as const, label: "Dashboard", icon: LayoutDashboard, desc: "Network overview dashboard", exact: false },
      { to: "/roadmap" as const, label: "Roadmap", icon: Route, desc: "Protocol milestones & RFCs", exact: false },
    ],
  },
  {
    id: "trade",
    label: "Trade",
    accent: "text-gold",
    showSubNav: true,
    extraPrefixes: [] as readonly string[],
    items: [
      { to: "/swap" as const, label: "Swap", icon: ArrowLeftRight, desc: "KVP-102 AMM swaps & Wave A batch", exact: false },
      { to: "/pools" as const, label: "Liquidity Pools", icon: Waves, desc: "AMM liquidity pools (x·y=k)", exact: false },
      { to: "/wallet/dex" as const, label: "Orderbook DEX", icon: Layers, desc: "On-chain limit orderbook", exact: false },
      { to: "/wallet/atomic-swap" as const, label: "Atomic Swaps", icon: Sparkles, desc: "Cross-chain HTLC swaps", exact: false },
    ],
  },
  {
    id: "assets",
    label: "Assets",
    accent: "text-gold",
    showSubNav: true,
    extraPrefixes: ["/wallet/collection/", "/wallet/nft/"] as readonly string[],
    items: [
      { to: "/multi-asset" as const, label: "Multi-Asset", icon: Layers, desc: "KVP-102 token balances & transfers", exact: false },
      { to: "/nft" as const, label: "Native NFTs", icon: Image, desc: "KVP-106 non-fungible assets", exact: false },
      { to: "/wallet/token-listings" as const, label: "Token Listings", icon: Gem, desc: "Token registry submissions", exact: false },
    ],
  },
  {
    id: "wallet",
    label: "Wallet",
    accent: "text-teal",
    showSubNav: true,
    extraPrefixes: [] as readonly string[],
    items: [
      { to: "/wallet" as const, label: "Wallet", icon: Wallet, desc: "PRO-21 vault, hardware & sends", exact: true },
      { to: "/faucet" as const, label: "Faucet", icon: Droplets, desc: "Claim testnet KVNC", exact: false },
      { to: "/wallet/airdrops" as const, label: "Airdrops", icon: Coins, desc: "Batch token distribution", exact: false },
      { to: "/wallet/coinjoin" as const, label: "CoinJoin", icon: Shield, desc: "Collaborative privacy rounds", exact: false },
      { to: "/wallet/ecosystem-tools" as const, label: "Ecosystem Tools", icon: Wrench, desc: "Scheduler, bridge & passkeys", exact: false },
    ],
  },
  {
    id: "build",
    label: "Build",
    accent: "text-blue",
    showSubNav: false,
    extraPrefixes: [] as readonly string[],
    items: [
      { to: "/multisig" as const, label: "Multisig", icon: Users, desc: "M-of-N shared custody", exact: false },
      { to: "/htlc" as const, label: "HTLC", icon: Lock, desc: "Hash Time-Locked Contracts", exact: false },
      { to: "/vaults" as const, label: "Vaults", icon: Vault, desc: "Time-locked vaults (CLTV / CSV)", exact: false },
      { to: "/stealth" as const, label: "Stealth", icon: Eye, desc: "KVP-103 one-time addresses", exact: false },
      { to: "/docs" as const, label: "Docs", icon: FileText, desc: "Protocol specs & CLI reference", exact: false },
      { to: "/api-reference" as const, label: "API Reference", icon: Terminal, desc: "JSON-RPC 2.0 & HTTP contract", exact: false },
      { to: "/playground" as const, label: "Playground", icon: Code2, desc: "Onboarding, API console & snippets", exact: false },
      { to: "/support" as const, label: "Support & Donations", icon: Heart, desc: "Support open-source protocol development", exact: false },
      { to: "/privacy" as const, label: "Privacy Policy", icon: Shield, desc: "Zero-telemetry & local custody policy", exact: false },
    ],
  },
] as const;

const MOBILE_PRIMARY_SLOTS = [
  { to: "/explorer" as const, label: "Explore", icon: Compass, exact: false },
  { to: "/swap" as const, label: "Swap", icon: ArrowLeftRight, exact: false },
  { to: "/multi-asset" as const, label: "Assets", icon: Layers, exact: false },
  { to: "/wallet" as const, label: "Wallet", icon: Wallet, exact: true },
] as const;

const ECOSYSTEM_SURFACES = [
  { href: SURFACE.landing, label: "Kovanica Apex", host: "kovanica.online", badge: null },
  { href: SURFACE.testnet, label: "Testnet Portal", host: "testnet.kovanica.online", badge: "Live" },
  { href: SURFACE.docs, label: "Documentation", host: "docs.kovanica.online", badge: null },
  { href: SURFACE.playground, label: "Playground", host: "playground.kovanica.online", badge: null },
  { href: SURFACE.dash, label: "Dashboard", host: "dash.kovanica.online", badge: null },
  { href: SURFACE.mainnet, label: SURFACE_STATUS.mainnet, host: "mainnet.kovanica.online", badge: "Preview" },
] as const;

function matchesPath(pathname: string, to: string, exact = false): boolean {
  if (to === "/" || exact) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

function isGroupActive(pathname: string, group: (typeof NAV_GROUPS)[number]): boolean {
  if (group.items.some((item) => matchesPath(pathname, item.to, item.exact))) {
    return true;
  }
  return group.extraPrefixes.some((prefix) => pathname.startsWith(prefix));
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

  const isItemActive = (to: string, exact = false) => matchesPath(pathname, to, exact);
  const activeGroup = NAV_GROUPS.find((group) => isGroupActive(pathname, group)) ?? null;
  const subNavGroup = activeGroup?.showSubNav ? activeGroup : null;
  const isMobilePrimaryActive = MOBILE_PRIMARY_SLOTS.some((slot) =>
    isItemActive(slot.to, slot.exact),
  );
  const compactHeaderSearch = pathname === "/swap" || pathname === "/pools";

  return (
    <ShellContext.Provider value={true}>
      <div className="flex min-h-dvh flex-col overflow-x-clip bg-bg text-fg">
        <header
          className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-bg/95 px-3 backdrop-blur-sm md:h-16 md:px-5"
          style={{ borderTop: `1px solid ${getBadgeColor()}` }}
        >
          <Link to="/" className="flex min-w-0 shrink-0 items-center gap-2">
            <img
              src={KVNC_COIN_ICON}
              alt=""
              aria-hidden="true"
              className="size-5.5 rounded-full object-cover ring-1 ring-gold/30"
            />
            <span className="flex items-baseline gap-2">
              <span className="font-display text-xl tracking-tight text-fg italic md:text-2xl">
                Kovanica
              </span>
              <span className="hidden font-mono text-[10px] tracking-brand text-blue uppercase 2xl:inline 2xl:text-xs">
                Protocol
              </span>
            </span>
          </Link>

          {/* Primary nav: 5 pure function tabs (Explore · Trade · Assets · Wallet · Build) */}
          <nav className="hidden items-center gap-0.5 lg:gap-1 md:flex" aria-label="Primary">
            {NAV_GROUPS.map((group) => {
              const active = activeGroup?.id === group.id;
              return (
                <DropdownMenu.Root key={group.id}>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors duration-150 outline-none lg:px-3 lg:text-sm",
                        active
                          ? "border-b-2 border-gold bg-surface-2 font-semibold text-fg shadow-xs"
                          : "text-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      <span>{group.label}</span>
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
                        {group.label}
                      </div>
                      {group.items.map((item) => {
                        const on = isItemActive(item.to, item.exact);
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
                              <Icon className={cn("size-4 shrink-0", group.accent)} />
                              <div className="flex flex-col">
                                <span className="text-fg">{item.label}</span>
                                <span className="text-[10px] font-normal text-muted">
                                  {item.desc}
                                </span>
                              </div>
                            </Link>
                          </DropdownMenu.Item>
                        );
                      })}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              );
            })}
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
          <div
            className={cn(
              "border-b border-border bg-bg/95 p-3 backdrop-blur-sm animate-in fade-in slide-in-from-top-2",
              compactHeaderSearch ? "" : "lg:hidden",
            )}
          >
            <GlobalSearch variant="navbar" onResolved={() => setMobileSearchOpen(false)} />
          </div>
        )}

        {/* Contextual section sub-nav strip (matches active Trade / Assets / Wallet group) */}
        {subNavGroup && (
          <nav
            aria-label={`${subNavGroup.label} navigation`}
            className="border-b border-border bg-surface/70 px-3 py-1.5 backdrop-blur-sm md:px-6"
          >
            <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto no-scrollbar">
              <span className="mr-1.5 hidden shrink-0 font-mono text-[10px] uppercase tracking-wider text-subtle sm:inline">
                {subNavGroup.label}
              </span>
              {subNavGroup.items.map((item) => {
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

        {/* Mobile bottom navigation: 5 slots (>=44px touch targets) + accessible More sheet */}
        <nav
          aria-label="Mobile"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
        >
          <ul className="grid grid-cols-5">
            {MOBILE_PRIMARY_SLOTS.map((item) => {
              const Icon = item.icon;
              const on = isItemActive(item.to, item.exact);
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
                      !isMobilePrimaryActive ? "font-semibold text-fg" : "text-muted",
                    )}
                  >
                    <Menu
                      className="size-5 shrink-0"
                      strokeWidth={!isMobilePrimaryActive ? 2.2 : 1.8}
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

                    {/* All 5 function groups in canonical order */}
                    {NAV_GROUPS.map((group) => (
                      <div key={group.id} className="mt-4">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-subtle">
                          {group.label}
                        </p>
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          {group.items.map((item) => {
                            const Icon = item.icon;
                            const on = isItemActive(item.to, item.exact);
                            return (
                              <Link
                                key={item.to}
                                to={item.to}
                                onClick={() => setMobileOpen(false)}
                                aria-current={on ? "page" : undefined}
                                className={cn(
                                  "flex items-center gap-2 rounded-lg border border-border/60 bg-bg/50 p-2.5 text-xs font-medium transition-colors",
                                  on
                                    ? "border-gold/50 bg-surface-2 text-fg"
                                    : "text-muted hover:text-fg",
                                )}
                              >
                                <Icon className={cn("size-4 shrink-0", group.accent)} />
                                <span className="truncate">{item.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))}

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
