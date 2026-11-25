import { Link } from "@tanstack/react-router";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { getSponsorConfig } from "@/lib/monetization";
import { cn } from "@/lib/utils";

export interface SponsorSlotProps {
  surface: "explorer" | "faucet" | "docs" | "pricing";
  showPlaceholder?: boolean;
  className?: string;
}

/**
 * Privacy-first static sponsor banner.
 * - Zero tracking cookies, zero third-party ad scripts.
 * - Renders an external sponsor ONLY when VITE_SPONSOR_URL (https://) and VITE_SPONSOR_TEXT are set.
 * - Otherwise renders an optional, unobtrusive 1-line link to /pricing?topic=sponsorship.
 */
export function SponsorSlot({
  surface,
  showPlaceholder = false,
  className,
}: SponsorSlotProps) {
  const sponsor = getSponsorConfig();

  if (sponsor) {
    return (
      <aside
        aria-label={`Sponsored partner on ${surface}`}
        data-testid={`sponsor-slot-${surface}`}
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/25 bg-surface/90 px-4 py-2.5 text-xs",
          className,
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 rounded border border-gold/30 bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gold">
            {sponsor.label}
          </span>
          <span className="truncate text-fg">{sponsor.text}</span>
        </div>
        <a
          href={sponsor.url}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] font-medium text-gold hover:underline"
        >
          <span>{sponsor.cta}</span>
          <ExternalLink className="size-3" />
        </a>
      </aside>
    );
  }

  if (!showPlaceholder) return null;

  return (
    <aside
      aria-label={`Sponsorship info for ${surface}`}
      data-testid={`sponsor-placeholder-${surface}`}
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-surface/50 px-3.5 py-2 text-[11px] text-muted",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <ShieldCheck className="size-3.5 shrink-0 text-teal" aria-hidden="true" />
        <span>Privacy-first sponsorship slot · Zero tracking cookies or ad scripts</span>
      </span>
      <Link
        to="/pricing"
        search={{ topic: "sponsorship" }}
        className="font-mono text-[11px] text-gold hover:underline"
      >
        Sponsor this surface →
      </Link>
    </aside>
  );
}
