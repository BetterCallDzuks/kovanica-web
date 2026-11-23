import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Gauge,
  GitBranch,
  Layers,
  Pause,
  Play,
  Radio,
  Zap,
} from "lucide-react";
import type { ApiState } from "@/lib/api/contract";
import type { LiveStreamTransport } from "@/lib/api/ws-stream";
import { classifyFeePressure } from "@/lib/explorer/fee-pressure";
import {
  MAX_LIVE_FEED_ENTRIES,
  extractLiveDagFeed,
  summarizeMempoolStream,
  type LiveDagFeedEntry,
} from "@/lib/explorer/live-feed";
import { shortId } from "@/lib/ledger/hash";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type LiveDagDrawerProps = {
  state: ApiState | null;
  transport?: LiveStreamTransport;
  paused?: boolean;
  onTogglePause?: () => void;
  defaultOpen?: boolean;
  onSelectBlock?: (hash: string) => void;
  feeRateAtomsPerByte?: bigint | number | string | null;
};

function formatBlockTime(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return "n/a";
  }
  try {
    return new Date(timestampMs).toISOString().slice(11, 19);
  } catch {
    return "n/a";
  }
}

/**
 * Collapsible Live DAG & Mempool Stream drawer for the Kovanica Explorer.
 *
 * Displays active transport mode, mempool pending transaction count, active
 * DAG tip count, and a bounded rolling feed of the most recent incoming DAG
 * blocks (up to 20 entries).
 */
export function LiveDagDrawer({
  state,
  transport = "polling",
  paused = false,
  onTogglePause,
  defaultOpen = true,
  onSelectBlock,
  feeRateAtomsPerByte,
}: LiveDagDrawerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [entries, setEntries] = useState<LiveDagFeedEntry[]>(() =>
    extractLiveDagFeed(state),
  );

  useEffect(() => {
    if (paused || !state) return;
    setEntries((prev) => extractLiveDagFeed(state, prev));
  }, [state, paused]);

  const effectiveTransport: LiveStreamTransport = paused ? "paused" : transport;

  const summary = useMemo(
    () => summarizeMempoolStream(state, effectiveTransport),
    [state, effectiveTransport],
  );

  const rawFeeRate =
    feeRateAtomsPerByte !== undefined
      ? feeRateAtomsPerByte
      : (state?.node?.min_fee ?? null);

  const feePressure = useMemo(
    () => classifyFeePressure(rawFeeRate, state ? summary.pendingTxCount : null),
    [rawFeeRate, state, summary.pendingTxCount],
  );

  const transportLabel =
    effectiveTransport === "ws"
      ? "WS Live"
      : effectiveTransport === "reconnecting"
        ? "Reconnecting"
        : effectiveTransport === "paused"
          ? "Paused"
          : "Polling";

  return (
    <section
      data-testid="live-dag-drawer"
      aria-label="Live DAG and Mempool Stream"
      className="border-b border-border bg-surface/40 px-4 py-3 md:px-6"
    >
      {/* Header / Drawer Toggle Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="live-dag-drawer-toggle"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
            className="inline-flex items-center gap-2 rounded-md py-0.5 text-left text-fg transition-colors hover:text-gold"
          >
            {open ? (
              <ChevronUp className="size-4 text-subtle" />
            ) : (
              <ChevronDown className="size-4 text-subtle" />
            )}
            <Layers className="size-4 text-gold" />
            <span className="font-display text-sm font-medium tracking-tight">
              Live DAG &amp; Mempool Stream
            </span>
          </button>

          <span
            data-testid="live-dag-drawer-transport"
            data-transport={effectiveTransport}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
              effectiveTransport === "ws"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : effectiveTransport === "reconnecting"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : effectiveTransport === "paused"
                    ? "border-border bg-surface text-muted"
                    : "border-border bg-bg text-muted",
            )}
          >
            {effectiveTransport === "ws" ? (
              <Radio className="size-3 animate-pulse text-emerald-400" />
            ) : (
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  effectiveTransport === "reconnecting"
                    ? "animate-pulse bg-amber-400"
                    : effectiveTransport === "paused"
                      ? "bg-subtle"
                      : "bg-gold/80",
                )}
              />
            )}
            {transportLabel}
          </span>
        </div>

        {/* Mempool & Tip Counters + Fee Pressure Pill + Pause Control */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="live-dag-fee-pressure-pill"
            data-fee-tier={feePressure.tier}
            title={`Fee pressure: ${feePressure.label} · Base ${feePressure.formattedBaseFee} · 1.2x buffered ${feePressure.formattedBufferedFee}`}
            className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] tabular-nums text-fg"
          >
            <Gauge className="size-3 shrink-0 text-gold" />
            <span className="text-subtle">Fee</span>
            <span
              data-testid="live-dag-fee-pressure-tier"
              className={cn(
                "rounded-full border px-1.5 py-0 text-[10px] font-medium",
                feePressure.tier === "low"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : feePressure.tier === "normal"
                    ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                    : feePressure.tier === "elevated"
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                      : feePressure.tier === "congested"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                        : "border-border bg-surface text-muted",
              )}
            >
              {feePressure.label}
            </span>
            <span data-testid="live-dag-fee-base" className="text-muted">
              {feePressure.formattedBaseFee}
            </span>
            <span className="text-subtle">·</span>
            <span
              data-testid="live-dag-fee-buffered"
              className="font-semibold text-gold"
            >
              1.2x {feePressure.formattedBufferedFee}
            </span>
          </span>

          <span
            data-testid="live-dag-drawer-mempool"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] tabular-nums text-fg"
          >
            <Zap className="size-3 text-gold" />
            <span className="text-subtle">Mempool</span>
            <span className="font-semibold">{summary.pendingTxCount}</span>
          </span>

          <span
            data-testid="live-dag-drawer-tips"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] tabular-nums text-fg"
          >
            <GitBranch className="size-3 text-gold" />
            <span className="text-subtle">Tips</span>
            <span className="font-semibold">{summary.tipCount}</span>
          </span>

          <span
            data-testid="live-dag-drawer-height"
            className="hidden items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] tabular-nums text-fg sm:inline-flex"
          >
            <span className="text-subtle">Height</span>
            <span className="font-semibold">
              {summary.latestHeight !== null
                ? `#${summary.latestHeight.toLocaleString()}`
                : "n/a"}
            </span>
          </span>

          {onTogglePause ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="live-dag-drawer-pause"
              aria-pressed={paused}
              aria-label={paused ? "Resume live DAG stream" : "Pause live DAG stream"}
              onClick={onTogglePause}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              {paused ? (
                <>
                  <Play className="size-3" />
                  <span>Resume</span>
                </>
              ) : (
                <>
                  <Pause className="size-3" />
                  <span>Pause</span>
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Collapsible Stream Feed */}
      {open ? (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-bg">
          {entries.length === 0 ? (
            <p className="px-3.5 py-4 text-xs text-muted">
              {paused
                ? "Live stream paused — no DAG blocks captured yet."
                : "Waiting for incoming DAG blocks…"}
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <ul
                data-testid="live-dag-feed-list"
                className="divide-y divide-border/60"
              >
                {entries.map((entry) => (
                  <li
                    key={entry.hash}
                    data-testid="live-dag-feed-item"
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2 text-xs transition-colors hover:bg-surface/60"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="w-16 shrink-0 font-mono text-[11px] font-semibold tabular-nums text-gold">
                        #{entry.height.toLocaleString()}
                      </span>

                      {onSelectBlock ? (
                        <button
                          type="button"
                          onClick={() => onSelectBlock(entry.hash)}
                          title={entry.hash}
                          className="truncate font-mono text-[11px] text-fg hover:text-gold hover:underline"
                        >
                          {shortId(entry.hash, 12)}…
                        </button>
                      ) : (
                        <span
                          title={entry.hash}
                          className="truncate font-mono text-[11px] text-fg"
                        >
                          {shortId(entry.hash, 12)}…
                        </span>
                      )}

                      {entry.isLeader ? (
                        <span className="shrink-0 rounded bg-gold/15 px-1.5 py-0.5 font-mono text-[9px] font-medium text-gold uppercase">
                          Leader
                        </span>
                      ) : null}

                      {entry.isTip ? (
                        <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-medium text-emerald-400 uppercase">
                          Tip
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2 font-mono text-[10px] tabular-nums">
                      <span className="rounded bg-surface px-1.5 py-0.5 text-muted">
                        {entry.txCount} tx
                      </span>

                      <span
                        className="inline-flex items-center gap-1 rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-sky-300"
                        title={`Blue score / count: ${entry.blueCount}`}
                      >
                        B:{entry.blueCount}
                      </span>

                      {entry.redCount > 0 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-rose-300"
                          title={`Red blocks / parents: ${entry.redCount}`}
                        >
                          R:{entry.redCount}
                        </span>
                      ) : null}

                      <span className="hidden w-16 text-right text-subtle sm:inline">
                        {formatBlockTime(entry.timestampMs)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border/60 bg-surface/30 px-3 py-1.5 font-mono text-[10px] text-subtle">
            <span>
              Showing {entries.length} of {MAX_LIVE_FEED_ENTRIES} max buffered blocks
            </span>
            <span>Newest first · UTC</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
