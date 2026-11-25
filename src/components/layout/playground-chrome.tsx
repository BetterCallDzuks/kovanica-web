/**
 * PlaygroundChrome — layout for playground.kovanica.online.
 * Three tabs: Onboarding, API Console, Code Snippets + cross-subdomain Ecosystem Switcher.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { GraduationCap, Terminal, Code2, Globe, ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { NetworkBadge } from "@/components/layout/network-badge";
import { SURFACE, SURFACE_STATUS } from "@/lib/surfaces";

const TABS = [
  { to: "/playground", label: "Onboarding", icon: GraduationCap },
  { to: "/playground/api-console", label: "API Console", icon: Terminal },
  { to: "/playground/snippets", label: "Snippets", icon: Code2 },
] as const;

const ECOSYSTEM_LINKS = [
  { href: SURFACE.landing, label: "Kovanica Apex", host: "kovanica.online" },
  { href: SURFACE.testnet, label: "Testnet Portal", host: "testnet.kovanica.online" },
  { href: SURFACE.docs, label: "Documentation", host: "docs.kovanica.online" },
  { href: SURFACE.dash, label: "Dashboard", host: "dash.kovanica.online" },
  { href: SURFACE.mainnet, label: SURFACE_STATUS.mainnet, host: "mainnet.kovanica.online" },
] as const;

export function PlaygroundChrome({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-bg text-fg">
      <header
        className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 backdrop-blur-sm md:h-16 md:px-6"
        style={{ borderTop: "1px solid #8b5cf6" }}
      >
        <Link to="/playground" className="flex min-w-0 items-baseline gap-2">
          <span className="font-display text-xl tracking-tight text-fg italic md:text-2xl">
            Kovanica
          </span>
          <span className="font-mono text-[10px] tracking-brand text-purple-400 uppercase md:text-xs">
            Playground
          </span>
        </Link>
        <nav className="hidden items-center gap-0.5 sm:flex" aria-label="Playground">
          {TABS.map((item) => {
            const on =
              item.to === "/playground"
                ? pathname === "/playground" || pathname === "/playground/"
                : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center rounded-md px-2.5 text-sm font-medium transition-colors duration-150",
                  on ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="Ecosystem surfaces"
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg outline-none"
              >
                <Globe className="size-3.5 text-gold" />
                <span className="hidden md:inline">Ecosystem</span>
                <ChevronDown className="size-3 opacity-70" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={8}
                className="z-50 min-w-56 rounded-xl border border-border bg-surface p-1.5 shadow-xl focus:outline-none"
              >
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-subtle">
                  Kovanica Ecosystem
                </div>
                {ECOSYSTEM_LINKS.map((surf) => (
                  <DropdownMenu.Item key={surf.href} asChild>
                    <a
                      href={surf.href}
                      className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-xs text-muted outline-none transition-colors hover:bg-surface-2 hover:text-fg"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-fg">{surf.label}</span>
                        <span className="font-mono text-[10px] text-subtle">{surf.host}</span>
                      </div>
                      <ExternalLink className="size-3 shrink-0 opacity-60" />
                    </a>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <NetworkBadge />
        </div>
      </header>

      {/* Mobile tab bar */}
      <nav
        aria-label="Playground mobile"
        className="sticky top-14 z-20 flex border-b border-border bg-bg/95 sm:hidden"
      >
        <div className="grid w-full grid-cols-3">
          {TABS.map((item) => {
            const Icon = item.icon;
            const on =
              item.to === "/playground"
                ? pathname === "/playground" || pathname === "/playground/"
                : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium leading-tight",
                  on ? "text-fg" : "text-muted",
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={on ? 2.2 : 1.8} />
                <span className="truncate max-w-full">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
