import { useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  Clock,
  Coins,
  Copy,
  Cpu,
  GitBranch,
  Pause,
  Play,
  Radio,
  RefreshCw,
} from "lucide-react";
import type { ApiState } from "@/lib/api/contract";
import { healthLabel } from "@/lib/api/health";
import type { LiveStreamTransport } from "@/lib/api/ws-stream";
import {
  BLOCKS_PER_ERA,
  TARGET_BLOCK_INTERVAL_MS,
  TARGET_BLOCK_INTERVAL_SEC,
  computeEmissionEra,
  computeObservedBlockInterval,
  formatCompactDifficulty,
  formatKvncReward,
} from "@/lib/explorer/mining-metrics";
import { shortId } from "@/lib/ledger/hash";
import type { Block } from "@/lib/ledger/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type MiningDagPanelProps = {
  state: ApiState | null;
  blocks: Block[];
  error: string | null;
  errorStatus: number | null;
  selectedBlockId?: string | null;
  transport?: LiveStreamTransport;
  paused?: boolean;
  onTogglePause?: () => void;
  onSelectTip?: (tipHash: string) => void;
  onRefresh?: () => void;
};

const MAX_VISIBLE_TIPS = 4;

/**
 * Live Mining & DAG Telemetry Dashboard.
 *
 * Renders truthful consensus telemetry sourced from `/api/state` (which queries
 * `kovanica_getMiningInfo`, `kovanica_getDagTips`, and `kovanica_syncStatus`).
 * Offline and degraded states display `n/a` rather than fabricated zeros.
 */
export function MiningDagPanel({
  state,
  blocks,
  error,
  errorStatus,
  selectedBlockId,
  transport = "polling",
  paused = false,
  onTogglePause,
  onSelectTip,
  onRefresh,
}: MiningDagPanelProps) {
  const [copiedTip, setCopiedTip] = useState<string | null>(null);
  const [showAllTips, setShowAllTips] = useState(false);

  const node = state?.node ?? null;
  const miningInfo = node?.mining_info ?? null;
  const tips = useMemo(() => node?.tips ?? [], [node?.tips]);
  const selectedTip = node?.selected_tip ?? null;
  const ghostdagK = miningInfo?.ghostdag_k ?? node?.k ?? null;

  const targetIntervalMs =
    miningInfo?.target_block_time_ms && miningInfo.target_block_time_ms > 0
      ? miningInfo.target_block_time_ms
      : TARGET_BLOCK_INTERVAL_MS;
  const targetIntervalSec = targetIntervalMs / 1000;

  const difficultyInfo = useMemo(
    () =>
      formatCompactDifficulty(
        miningInfo?.target_bits ?? null,
        miningInfo?.difficulty ?? null,
      ),
    [miningInfo?.target_bits, miningInfo?.difficulty],
  );

  const observedInterval = useMemo(
    () =>
      computeObservedBlockInterval(
        blocks.map((b) => b.timestamp),
        targetIntervalMs,
      ),
    [blocks, targetIntervalMs],
  );

  const emission = useMemo(
    () => computeEmissionEra(node ? node.blocks : null),
    [node],
  );

  const healthState = state?.health?.state ?? null;
  const isOffline = Boolean(error && !state);
  const isStalled = (isOffline && errorStatus === 503) || healthState === "stalled";
  const isLoading = !state && !error;

  const visibleTips = showAllTips ? tips : tips.slice(0, MAX_VISIBLE_TIPS);
  const hiddenTipCount = Math.max(0, tips.length - visibleTips.length);

  async function handleCopyTip(tip: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tip);
        setCopiedTip(tip);
        window.setTimeout(() => {
          setCopiedTip((prev) => (prev === tip ? null : prev));
        }, 1500);
      }
    } catch {
      // Clipboard may be blocked in non-secure contexts; ignore silently.
    }
  }

  return (
    <section
      aria-label="Live Mining and DAG Telemetry"
      className="border-b border-border bg-surface/40 px-4 py-4 md:px-6"
    >
      {/* Header row */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-gold" />
          <h2 className="font-display text-base tracking-tight text-fg">
            Live Mining &amp; DAG Telemetry
          </h2>
          {isOffline ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
                isStalled
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-danger/30 bg-danger/10 text-danger",
              )}
            >
              <AlertCircle className="size-3" />
              {isStalled ? healthLabel("stalled") : "Node Offline"}
            </span>
          ) : isLoading ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[10px] text-muted">
              <span className="size-1.5 rounded-full bg-gold animate-pulse" />
              Connecting…
            </span>
          ) : isStalled ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-300">
              <AlertCircle className="size-3" />
              Stalled · Read-Only
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live{ghostdagK !== null ? ` · GHOSTDAG K=${ghostdagK}` : ""}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="live-stream-badge"
            data-transport={transport}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
              transport === "ws"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : transport === "reconnecting"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : transport === "paused"
                    ? "border-border bg-surface text-muted"
                    : "border-border bg-bg text-muted",
            )}
          >
            {transport === "ws" ? (
              <Radio className="size-3 text-emerald-400 animate-pulse" />
            ) : (
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  transport === "reconnecting"
                    ? "bg-amber-400 animate-pulse"
                    : transport === "paused"
                      ? "bg-subtle"
                      : "bg-gold/80",
                )}
              />
            )}
            {transport === "ws"
              ? "WS Live"
              : transport === "reconnecting"
                ? "Reconnecting"
                : transport === "paused"
                  ? "Paused"
                  : "Polling"}
          </span>

          {onTogglePause ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="live-stream-toggle"
              aria-pressed={paused}
              aria-label={paused ? "Resume live updates" : "Pause live updates"}
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

          {isOffline && onRefresh ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="h-7 gap-1.5 text-xs"
            >
              <RefreshCw className="size-3" />
              Retry
            </Button>
          ) : null}
        </div>
      </div>

      {/* 4-card telemetry grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* 1. Active DAG Tips */}
        <article className="flex flex-col justify-between rounded-lg border border-border bg-bg p-3.5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wider text-subtle uppercase">
                <GitBranch className="size-3.5 text-gold" />
                Active DAG Tips
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums text-fg">
                {node ? tips.length : "n/a"}
              </span>
            </div>

            {!node ? (
              <p className="mt-2.5 text-xs text-muted">
                {isOffline
                  ? "DAG tip set unavailable while RPC is unreachable."
                  : "Waiting for kovanica_getDagTips…"}
              </p>
            ) : tips.length === 0 ? (
              <p className="mt-2.5 text-xs text-muted">
                No active tip hashes returned by RPC.
              </p>
            ) : (
              <ul className="mt-2.5 space-y-1.5">
                {visibleTips.map((tip) => {
                  const isHead = tip === selectedTip;
                  const isSelected = tip === selectedBlockId;
                  const isCopied = copiedTip === tip;
                  return (
                    <li
                      key={tip}
                      className={cn(
                        "flex items-center justify-between gap-1.5 rounded border px-2 py-1 text-xs transition-colors",
                        isSelected
                          ? "border-gold/50 bg-gold/10"
                          : "border-border/70 bg-surface/60 hover:border-border",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectTip?.(tip)}
                        title={tip}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-mono text-[11px] text-fg hover:text-gold"
                      >
                        <span className="truncate">{shortId(tip, 14)}…</span>
                        {isHead ? (
                          <span className="shrink-0 rounded bg-gold/15 px-1 py-0.2 text-[9px] font-medium text-gold uppercase">
                            head
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopyTip(tip)}
                        aria-label={`Copy tip hash ${shortId(tip, 8)}`}
                        title="Copy full tip hash"
                        className="shrink-0 rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-fg"
                      >
                        {isCopied ? (
                          <Check className="size-3 text-emerald-400" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {hiddenTipCount > 0 || showAllTips ? (
            <button
              type="button"
              onClick={() => setShowAllTips((v) => !v)}
              className="mt-2 self-start font-mono text-[10px] text-gold hover:underline"
            >
              {showAllTips ? "Show fewer tips" : `+${hiddenTipCount} more tip${hiddenTipCount === 1 ? "" : "s"}`}
            </button>
          ) : null}
        </article>

        {/* 2. PoW Difficulty & target_bits */}
        <article className="flex flex-col justify-between rounded-lg border border-border bg-bg p-3.5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wider text-subtle uppercase">
                <Cpu className="size-3.5 text-gold" />
                PoW Difficulty
              </span>
              <span className="font-mono text-[10px] text-subtle">
                {miningInfo?.pow_algorithm ?? "KovanicaHash"}
              </span>
            </div>

            <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-fg">
              {difficultyInfo ? difficultyInfo.difficultyFormatted : "n/a"}
            </p>

            <dl className="mt-2.5 space-y-1 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-subtle">target_bits</dt>
                <dd className="font-mono text-fg">
                  {difficultyInfo?.targetBitsHex ?? "n/a"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-subtle">Compact Target</dt>
                <dd
                  className="max-w-[160px] truncate font-mono text-muted"
                  title={difficultyInfo?.targetHex ?? undefined}
                >
                  {difficultyInfo?.targetHex
                    ? `${difficultyInfo.targetHex.slice(0, 14)}…`
                    : "n/a"}
                </dd>
              </div>
            </dl>
          </div>

          <p className="mt-2.5 border-t border-border/50 pt-2 text-[10px] text-subtle">
            {!node
              ? "Awaiting kovanica_getMiningInfo response."
              : difficultyInfo
                ? miningInfo?.mining_enabled === true
                  ? "Node miner active · LWMA DAA"
                  : miningInfo?.mining_enabled === false
                    ? "Node miner idle · LWMA DAA"
                    : "Reported via kovanica_getMiningInfo"
                : "Node RPC did not expose target_bits / difficulty."}
          </p>
        </article>

        {/* 3. Target vs Observed Block Interval */}
        <article className="flex flex-col justify-between rounded-lg border border-border bg-bg p-3.5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wider text-subtle uppercase">
                <Clock className="size-3.5 text-gold" />
                Block Interval
              </span>
              {observedInterval ? (
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono text-[10px] font-medium",
                    observedInterval.status === "on-target"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : observedInterval.status === "fast"
                        ? "bg-gold/10 text-gold"
                        : "bg-amber-500/10 text-amber-300",
                  )}
                >
                  {observedInterval.status === "on-target"
                    ? "On Target"
                    : observedInterval.status === "fast"
                      ? "Fast"
                      : "Slow"}
                </span>
              ) : null}
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-lg font-semibold tabular-nums text-fg">
                {observedInterval ? `${observedInterval.avgIntervalSec.toFixed(2)}s` : "n/a"}
              </span>
              <span className="font-mono text-xs text-subtle">
                / {targetIntervalSec.toFixed(1)}s target
              </span>
            </div>

            <dl className="mt-2.5 space-y-1 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-subtle">Target Interval</dt>
                <dd className="font-mono text-fg">
                  {TARGET_BLOCK_INTERVAL_SEC.toFixed(1)}s ({targetIntervalMs.toLocaleString()} ms)
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-subtle">Observed Delta</dt>
                <dd className="font-mono tabular-nums text-muted">
                  {observedInterval
                    ? `${observedInterval.deltaFromTargetMs >= 0 ? "+" : ""}${(observedInterval.deltaFromTargetMs / 1000).toFixed(2)}s`
                    : "n/a"}
                </dd>
              </div>
            </dl>
          </div>

          <p className="mt-2.5 border-t border-border/50 pt-2 text-[10px] text-subtle">
            {observedInterval
              ? `Measured across ${observedInterval.sampleCount} recent DAG blocks.`
              : !node
                ? "Unavailable while node is offline."
                : "Requires ≥2 recent block headers to measure."}
          </p>
        </article>

        {/* 4. NoStake82M Emission Era */}
        <article className="flex flex-col justify-between rounded-lg border border-border bg-bg p-3.5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wider text-subtle uppercase">
                <Coins className="size-3.5 text-gold" />
                NoStake82M Emission
              </span>
              <span className="font-mono text-[11px] font-semibold text-gold">
                {emission ? `Era #${emission.era}` : "n/a"}
              </span>
            </div>

            <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-fg">
              {emission ? formatKvncReward(emission.rewardKvnc) : "n/a"}
            </p>

            {/* Era progress bar */}
            <div className="mt-2.5">
              <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-subtle">
                <span>
                  {emission
                    ? `${emission.blockInEra.toLocaleString()} / ${BLOCKS_PER_ERA.toLocaleString()}`
                    : `— / ${BLOCKS_PER_ERA.toLocaleString()}`}
                </span>
                <span className="tabular-nums">
                  {emission ? `${emission.progressPct.toFixed(2)}%` : "n/a"}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-gold transition-all duration-300"
                  style={{
                    width: emission ? `${Math.min(100, Math.max(0.5, emission.progressPct))}%` : "0%",
                  }}
                />
              </div>
            </div>
          </div>

          <p className="mt-2.5 border-t border-border/50 pt-2 font-mono text-[10px] text-subtle">
            {emission
              ? `Next era: ${formatKvncReward(emission.nextEraRewardKvnc)} · ${emission.blocksRemaining.toLocaleString()} blk left`
              : "2.5 × (3/4)^era KVNC · 8.2M blocks/era"}
          </p>
        </article>
      </div>
    </section>
  );
}
