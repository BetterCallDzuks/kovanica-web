import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  Search,
  X,
  AlertCircle,
  ArrowRight,
  Boxes,
  Compass,
  FileCode,
  Gem,
  Landmark,
  Loader2,
  Tag,
  Wallet,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  resolveSearchQuery,
  resolveSearchQueryAsync,
  type RouteTarget,
  type ResolutionResult,
} from "@/lib/search/resolver";
import { resolveSearchShortcuts, type SearchShortcutAction } from "@/lib/search/shortcuts";
import { useNode } from "@/lib/api/use-node";
import type { ApiState } from "@/lib/api/contract";

export interface GlobalSearchProps {
  variant?: "navbar" | "explorer";
  className?: string;
  placeholder?: string;
  onResolved?: (target: RouteTarget) => void;
  /** Optional parent-managed node state to avoid duplicate `/api/state` polling. */
  externalState?: ApiState | null;
}

export function GlobalSearch({
  variant = "navbar",
  className,
  placeholder,
  onResolved,
  externalState,
}: GlobalSearchProps) {
  const router = useRouter();
  const hasExternalState = externalState !== undefined;
  const { state: polledState, source } = useNode(variant === "explorer" ? 2000 : undefined, {
    paused: hasExternalState,
  });
  const state = hasExternalState ? externalState : polledState;
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [resolution, setResolution] = useState<ResolutionResult | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shortcuts = useMemo(() => resolveSearchShortcuts(query), [query]);

  // Sync resolution whenever query changes
  useEffect(() => {
    if (!query.trim()) {
      setResolution(null);
      setIsProbing(false);
      return;
    }

    const syncRes = resolveSearchQuery(query, {
      source,
      blocks: state?.node.dag,
    });
    setResolution(syncRes);

    // If ambiguous 64-hex, trigger background probe
    if (syncRes.parse.type === "ambiguous_hex") {
      setIsProbing(true);
      let active = true;
      void resolveSearchQueryAsync(query, { source, probeEndpoints: true }).then((asyncRes) => {
        if (!active) return;
        setIsProbing(false);
        // If async probing found a specific asset type, update resolution
        if (asyncRes.target && asyncRes.target.type !== "block") {
          setResolution(asyncRes);
        }
      });
      return () => {
        active = false;
      };
    } else {
      setIsProbing(false);
    }
  }, [query, source, state]);

  // Click outside to dismiss suggestions
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Keyboard shortcut: '/' to focus search input
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleNavigate(target: RouteTarget) {
    setIsOpen(false);
    if (onResolved) {
      onResolved(target);
    }
    void router.navigate({
      to: target.path as never,
      search: target.search as never,
      params: target.params as never,
    });
  }

  function handleShortcutNavigate(shortcut: SearchShortcutAction) {
    setIsOpen(false);
    void router.navigate({ href: shortcut.href });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (resolution?.ok && resolution.target) {
        handleNavigate(resolution.target);
        return;
      }
      if (shortcuts.length > 0) {
        handleShortcutNavigate(shortcuts[0]!);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  }

  function clearSearch() {
    setQuery("");
    setResolution(null);
    setIsOpen(false);
    inputRef.current?.focus();
  }

  const defaultPlaceholder =
    variant === "explorer"
      ? "Search address (kvnc…dag), block digest, tx hash, token, or asset ID…"
      : "Search address, tx, block, token, or asset ID…";

  const isNavbar = variant === "navbar";

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex-1",
        isNavbar ? "max-w-md w-full" : "w-full max-w-2xl",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border bg-surface transition-all duration-150",
          isOpen ? "border-gold/60 ring-1 ring-gold/40 shadow-lg" : "border-border hover:border-border/80",
          isNavbar ? "h-9 px-2.5 text-xs" : "h-11 px-3.5 text-sm",
        )}
      >
        <Search
          className={cn(
            "shrink-0 text-muted transition-colors",
            isOpen ? "text-gold" : "text-muted",
            isNavbar ? "size-3.5" : "size-4",
          )}
          aria-hidden="true"
        />

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || defaultPlaceholder}
          aria-label="Explorer and account global search"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          className={cn(
            "w-full bg-transparent font-sans text-fg placeholder:text-muted/60 outline-none",
            isNavbar ? "text-xs" : "text-sm",
          )}
        />

        {isProbing && (
          <Loader2 className="size-3.5 animate-spin text-muted shrink-0" aria-label="Probing" />
        )}

        {query ? (
          <button
            type="button"
            onClick={clearSearch}
            className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Clear search query"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd
            className="hidden select-none rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline-block"
            title="Press / to search"
          >
            /
          </kbd>
        )}
      </div>

      {/* Quick-Jump Shortcut Pills */}
      {shortcuts.length > 0 && (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Quick-jump search shortcuts"
        >
          {shortcuts.map((shortcut) => (
            <button
              key={shortcut.id}
              type="button"
              data-testid={`search-shortcut-${shortcut.id}`}
              onClick={() => handleShortcutNavigate(shortcut)}
              title={shortcut.description}
              className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-surface-2/80 px-2.5 py-1 text-[11px] font-medium text-fg transition-colors hover:border-gold/70 hover:bg-gold/10 hover:text-gold"
            >
              <span className="rounded bg-gold/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold">
                {shortcut.badge}
              </span>
              <span>{shortcut.label}</span>
              <ArrowRight className="size-3 shrink-0 text-muted" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {/* Live Suggestions & Error Popover */}
      {isOpen && query.trim() !== "" && (resolution?.ok || shortcuts.length === 0) && (
        <div className="absolute top-full left-0 z-50 mt-1.5 w-full rounded-xl border border-border bg-surface p-2 shadow-2xl backdrop-blur-md">
          {/* Case A: Malformed or Unrecognized */}
          {resolution && !resolution.ok && (
            <div className="p-3">
              <div className="flex items-start gap-2.5 text-danger">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold">
                    {resolution.parse.type === "malformed"
                      ? "Malformed Search Query"
                      : "Unrecognized Search Query"}
                  </p>
                  <p className="text-xs text-muted leading-relaxed">
                    {resolution.error}
                  </p>
                </div>
              </div>

              <div className="mt-3 border-t border-border/50 pt-2.5 text-[11px] text-muted">
                <p className="font-semibold text-subtle uppercase tracking-wider text-[10px]">
                  Supported Formats:
                </p>
                <ul className="mt-1.5 space-y-1 font-mono text-[11px] text-muted">
                  <li className="flex items-center gap-1.5">
                    <span className="text-fg font-semibold">• PRO-21 Address:</span>
                    <span className="text-subtle">kvnc…dag (64 chars)</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="text-fg font-semibold">• 32-byte Hex Hash:</span>
                    <span className="text-subtle">64-character block, tx, or pubkey</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="text-fg font-semibold">• Prefixes:</span>
                    <span className="text-subtle">name:, block:, tx:, addr:, nft:, rwa:, col:</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="text-fg font-semibold">• Tokens:</span>
                    <span className="text-subtle">KVNC, KUNA, INK, COPPER, PAPER</span>
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* Case B: Resolved single target */}
          {resolution && resolution.ok && resolution.target && !resolution.candidates && (
            <div className="space-y-1">
              <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-subtle flex items-center justify-between">
                <span>Matched Destination</span>
                <span className="rounded bg-gold/10 px-1.5 py-0.2 text-[10px] text-gold font-medium">
                  {resolution.target.badge}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleNavigate(resolution.target!)}
                className="w-full flex items-center justify-between rounded-lg p-2.5 text-left transition-colors hover:bg-surface-2 group outline-none"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 border border-border group-hover:border-gold/40">
                    <TargetIcon type={resolution.target.type} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-fg group-hover:text-gold truncate">
                      {resolution.target.label}
                    </p>
                    <p className="text-[11px] text-muted truncate">
                      {resolution.target.description}
                    </p>
                  </div>
                </div>
                <ArrowRight className="size-4 text-muted group-hover:text-gold shrink-0 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          )}

          {/* Case C: Ambiguous 32-byte hex with candidates */}
          {resolution && resolution.ok && resolution.candidates && (
            <div className="space-y-1">
              <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-subtle flex items-center justify-between">
                <span>32-Byte Hex Digest ({resolution.parse.cleanHex?.slice(0, 8)}…)</span>
                <span className="text-[10px] text-muted">Press Enter for primary or select view</span>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-1">
                {resolution.candidates.map((cand, idx) => (
                  <button
                    key={cand.type}
                    type="button"
                    onClick={() => handleNavigate(cand)}
                    className={cn(
                      "w-full flex items-center justify-between rounded-lg p-2 text-left transition-colors hover:bg-surface-2 group outline-none",
                      idx === 0 ? "bg-surface-2/60 border border-border/80" : "",
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-bg border border-border">
                        <TargetIcon type={cand.type} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-fg group-hover:text-gold">
                            {cand.label}
                          </span>
                          <span className="rounded bg-surface px-1 py-0.2 text-[9px] font-mono text-muted uppercase">
                            {cand.badge}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted truncate">{cand.description}</p>
                      </div>
                    </div>
                    <ArrowRight className="size-3.5 text-muted group-hover:text-gold shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TargetIcon({ type }: { type: RouteTarget["type"] }) {
  switch (type) {
    case "address":
      return <Wallet className="size-4 text-blue" />;
    case "block":
      return <Boxes className="size-4 text-gold" />;
    case "tx":
      return <FileCode className="size-4 text-teal" />;
    case "collection":
      return <Tag className="size-4 text-purple-400" />;
    case "nft":
      return <Gem className="size-4 text-purple-400" />;
    case "rwa":
      return <Landmark className="size-4 text-amber-400" />;
    case "token":
      return <Sparkles className="size-4 text-ok" />;
    default:
      return <Compass className="size-4 text-muted" />;
  }
}
