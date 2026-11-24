import { Activity, AlertTriangle, Clock, Droplets, Wallet, WifiOff } from "lucide-react";
import {
  formatCooldownRemaining,
  formatFaucetBalanceKvnc,
  type FaucetHealthStatus,
  type FaucetTelemetrySummary,
} from "@/lib/faucet/faucet-telemetry";
import { cn } from "@/lib/utils";

export interface FaucetStatusBarProps {
  summary: FaucetTelemetrySummary;
  cooldownRemainingMs?: number;
  loading?: boolean;
  className?: string;
}

const STATUS_META: Record<
  FaucetHealthStatus,
  { label: string; badgeClass: string }
> = {
  online: {
    label: "Online",
    badgeClass: "border-ok/40 bg-ok/10 text-ok",
  },
  low_balance: {
    label: "Low Balance",
    badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  unavailable: {
    label: "Unavailable",
    badgeClass: "border-border bg-bg text-muted",
  },
};

/**
 * Compact faucet telemetry status bar displaying faucet health, KVNC balance,
 * total successful drips, and a live cooldown countdown badge when active.
 */
export function FaucetStatusBar({
  summary,
  cooldownRemainingMs = 0,
  loading = false,
  className,
}: FaucetStatusBarProps) {
  const statusMeta = STATUS_META[summary.status];
  const hasActiveCooldown = Number.isFinite(cooldownRemainingMs) && cooldownRemainingMs > 0;
  const cooldownLabel = formatCooldownRemaining(cooldownRemainingMs);

  return (
    <section
      aria-label="Faucet telemetry status"
      data-testid="faucet-status-bar"
      className={cn(
        "rounded-xl border border-border bg-surface px-4 py-3 text-xs",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          data-testid="faucet-health-badge"
          data-health-status={loading ? "loading" : summary.status}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium",
            loading ? "border-border bg-bg text-muted" : statusMeta.badgeClass,
          )}
        >
          {loading ? (
            <Activity className="size-3 shrink-0 animate-pulse" aria-hidden="true" />
          ) : summary.status === "online" ? (
            <Activity className="size-3 shrink-0" aria-hidden="true" />
          ) : summary.status === "low_balance" ? (
            <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
          ) : (
            <WifiOff className="size-3 shrink-0" aria-hidden="true" />
          )}
          <span>{loading ? "Checking…" : statusMeta.label}</span>
        </span>

        {hasActiveCooldown && (
          <span
            data-testid="faucet-cooldown-badge"
            className="inline-flex items-center gap-1.5 rounded-full border border-blue/30 bg-blue/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-blue"
          >
            <Clock className="size-3 shrink-0" aria-hidden="true" />
            <span>Cooldown: {cooldownLabel}</span>
          </span>
        )}
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border/70 pt-2.5">
        <div className="flex items-center gap-1.5 text-muted">
          <Wallet className="size-3.5 shrink-0 text-subtle" aria-hidden="true" />
          <span className="text-subtle">Balance</span>
          <span
            data-testid="faucet-balance"
            className="ml-auto font-mono font-medium text-fg"
          >
            {formatFaucetBalanceKvnc(summary.balanceAtoms)}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-muted">
          <Droplets className="size-3.5 shrink-0 text-subtle" aria-hidden="true" />
          <span className="text-subtle">Drips</span>
          <span
            data-testid="faucet-drips-total"
            className="ml-auto font-mono font-medium text-fg"
          >
            {summary.dripsSucceededTotal !== null
              ? summary.dripsSucceededTotal.toLocaleString("en-US")
              : "—"}
          </span>
        </div>
      </div>
    </section>
  );
}
