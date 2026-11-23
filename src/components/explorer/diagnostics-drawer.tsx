import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { ApiSource, ApiState } from "@/lib/api/contract";
import { withSource } from "@/lib/api/client";
import type { LiveStreamTransport } from "@/lib/api/ws-stream";
import {
  buildExplorerDiagnosticsSnapshot,
  formatDiagnosticsJson,
} from "@/lib/explorer/diagnostics";
import {
  DEFAULT_LATENCY_RING_CAPACITY,
  classifySyncLag,
  pushLatencySample,
  summarizeLatencyRing,
  type LatencySample,
} from "@/lib/explorer/latency-ring";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const PROBE_INTERVAL_MS = 5000;
const SPARKLINE_WIDTH = 160;
const SPARKLINE_HEIGHT = 36;

function formatLatencyMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  if (value < 10) return `${value.toFixed(1)} ms`;
  return `${Math.round(value)} ms`;
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export type ExplorerDiagnosticsDrawerProps = {
  source: ApiSource;
  transport: LiveStreamTransport;
  paused: boolean;
  state: ApiState | null;
  error?: string | null;
  errorStatus?: number | null;
  defaultOpen?: boolean;
};

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy textarea fallback when clipboard permission is unavailable
    }
  }
  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (copied) return true;
    } catch {
      // Ignore fallback failures in restricted contexts
    }
  }
  return false;
}

/**
 * Collapsible Node & Network Diagnostics drawer with sanitized support bundle export.
 */
export function ExplorerDiagnosticsDrawer({
  source,
  transport,
  paused,
  state,
  error = null,
  errorStatus = null,
  defaultOpen = false,
}: ExplorerDiagnosticsDrawerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const [latencyRing, setLatencyRing] = useState<LatencySample[]>([]);
  const [probeHighestHeight, setProbeHighestHeight] = useState<number | null>(null);
  const [probing, setProbing] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probeAbortRef = useRef<AbortController | null>(null);
  const probeGenRef = useRef(0);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const runProbe = useCallback(async () => {
    if (source === "mainnet" || typeof fetch === "undefined") {
      return;
    }
    const myGen = probeGenRef.current;
    if (probeAbortRef.current) {
      probeAbortRef.current.abort();
    }
    const ctrl = new AbortController();
    probeAbortRef.current = ctrl;
    setProbing(true);

    const startedAt = nowMs();
    try {
      const res = await fetch(withSource("/api/head", source), {
        method: "GET",
        signal: ctrl.signal,
      });
      const elapsedMs = Math.max(0, nowMs() - startedAt);
      let headBlocks: number | null = null;
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("json")) {
          try {
            const data = (await res.json()) as { blocks?: unknown };
            if (typeof data.blocks === "number" && Number.isFinite(data.blocks)) {
              headBlocks = data.blocks;
            }
          } catch {
            // Ignore malformed JSON body during latency probe
          }
        }
      }
      if (myGen !== probeGenRef.current) return;
      if (headBlocks !== null) {
        setProbeHighestHeight(headBlocks);
      }
      setLatencyRing((prev) =>
        pushLatencySample(
          prev,
          { latencyMs: elapsedMs, ok: res.ok, timestampMs: Date.now() },
          DEFAULT_LATENCY_RING_CAPACITY,
        ),
      );
    } catch (probeErr: unknown) {
      if (
        probeErr &&
        typeof probeErr === "object" &&
        "name" in probeErr &&
        (probeErr as { name?: unknown }).name === "AbortError"
      ) {
        return;
      }
      if (myGen !== probeGenRef.current) return;
      const elapsedMs = Math.max(0, nowMs() - startedAt);
      setLatencyRing((prev) =>
        pushLatencySample(
          prev,
          { latencyMs: elapsedMs, ok: false, timestampMs: Date.now() },
          DEFAULT_LATENCY_RING_CAPACITY,
        ),
      );
    } finally {
      if (myGen === probeGenRef.current) {
        setProbing(false);
      }
      if (probeAbortRef.current === ctrl) {
        probeAbortRef.current = null;
      }
    }
  }, [source]);

  // Reset ring and run an initial probe whenever the network source changes
  useEffect(() => {
    probeGenRef.current += 1;
    if (probeAbortRef.current) {
      probeAbortRef.current.abort();
      probeAbortRef.current = null;
    }
    setLatencyRing([]);
    setProbeHighestHeight(null);
    setProbing(false);

    if (source === "mainnet") {
      return;
    }

    void runProbe();

    return () => {
      probeGenRef.current += 1;
      if (probeAbortRef.current) {
        probeAbortRef.current.abort();
        probeAbortRef.current = null;
      }
    };
  }, [source, runProbe]);

  // Periodic health probes while live (unpaused) and not on mainnet prelaunch
  useEffect(() => {
    if (paused || source === "mainnet") {
      return;
    }
    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      void runProbe();
    }, PROBE_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [paused, source, runProbe]);

  const effectiveTransport: LiveStreamTransport = paused ? "paused" : transport;

  const snapshot = useMemo(
    () =>
      buildExplorerDiagnosticsSnapshot({
        source,
        transport: effectiveTransport,
        paused,
        state,
        error,
        errorStatus,
      }),
    [source, effectiveTransport, paused, state, error, errorStatus],
  );

  const latencySummary = useMemo(
    () => summarizeLatencyRing(latencyRing, SPARKLINE_WIDTH, SPARKLINE_HEIGHT),
    [latencyRing],
  );

  const highestObservedHeight = useMemo(() => {
    const candidates: number[] = [];
    if (snapshot.committedHeight !== null) {
      candidates.push(snapshot.committedHeight);
    }
    if (probeHighestHeight !== null) {
      candidates.push(probeHighestHeight);
    }
    const meshNodes = state?.mesh?.nodes;
    if (Array.isArray(meshNodes)) {
      for (const node of meshNodes) {
        if (typeof node?.blocks === "number" && Number.isFinite(node.blocks)) {
          candidates.push(node.blocks);
        }
      }
    }
    return candidates.length > 0 ? Math.max(...candidates) : null;
  }, [snapshot.committedHeight, probeHighestHeight, state]);

  const syncLag = useMemo(
    () => classifySyncLag(snapshot.committedHeight, highestObservedHeight),
    [snapshot.committedHeight, highestObservedHeight],
  );

  const formattedJson = useMemo(() => formatDiagnosticsJson(snapshot), [snapshot]);

  const handleCopy = useCallback(async () => {
    const freshSnapshot = buildExplorerDiagnosticsSnapshot({
      source,
      transport: effectiveTransport,
      paused,
      state,
      error,
      errorStatus,
      generatedAt: new Date(),
    });
    const payload = formatDiagnosticsJson(freshSnapshot);
    await copyTextToClipboard(payload);
    setCopied(true);
    if (copiedTimerRef.current !== null) {
      clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, 2000);
  }, [source, effectiveTransport, paused, state, error, errorStatus]);

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
      data-testid="explorer-diagnostics-drawer"
      aria-label="Node and Network Diagnostics"
      className="border-b border-border bg-surface/30 px-4 py-3 md:px-6"
    >
      {/* Header / Toggle Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="explorer-diagnostics-toggle"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
            className="inline-flex items-center gap-2 rounded-md py-0.5 text-left text-fg transition-colors hover:text-gold"
          >
            {open ? (
              <ChevronUp className="size-4 text-subtle" />
            ) : (
              <ChevronDown className="size-4 text-subtle" />
            )}
            <Activity className="size-4 text-gold" />
            <span className="font-display text-sm font-medium tracking-tight">
              Node &amp; Network Diagnostics
            </span>
          </button>

          <span
            data-testid="explorer-diagnostics-transport"
            data-transport={effectiveTransport}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
              effectiveTransport === "ws"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : effectiveTransport === "reconnecting"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
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

          <span
            data-testid="explorer-diagnostics-tag-badge"
            data-verified={snapshot.networkTagVerified ? "true" : "false"}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
              snapshot.networkTagVerified
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300",
            )}
          >
            {snapshot.networkTagVerified ? (
              <ShieldCheck className="size-3" />
            ) : (
              <ShieldAlert className="size-3" />
            )}
            <span>
              {snapshot.networkTagVerified ? "Tag Verified" : "Tag Unverified"}
              {snapshot.networkTag ? ` · ${snapshot.networkTag}` : ""}
            </span>
          </span>

          <span
            data-testid="diagnostics-sync-lag-badge"
            data-sync-status={syncLag.status}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
              syncLag.status === "synced"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : syncLag.status === "lagging"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : syncLag.status === "stalled"
                    ? "border-danger/40 bg-danger/10 text-danger"
                    : "border-border bg-bg text-muted",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                syncLag.status === "synced"
                  ? "bg-emerald-400"
                  : syncLag.status === "lagging"
                    ? "bg-amber-400"
                    : syncLag.status === "stalled"
                      ? "bg-danger"
                      : "bg-subtle",
              )}
            />
            <span>{syncLag.label}</span>
          </span>
        </div>

        {/* Compact Telemetry Summary */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-fg">
            <span className="text-subtle">Peers</span>
            <span className="font-semibold">
              {snapshot.peerCount !== null ? snapshot.peerCount : "n/a"}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-fg">
            <span className="text-subtle">Mempool</span>
            <span className="font-semibold">
              {snapshot.mempoolCount !== null ? snapshot.mempoolCount : "n/a"}
            </span>
          </span>
          <span className="hidden items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-fg sm:inline-flex">
            <span className="text-subtle">Height</span>
            <span className="font-semibold">
              {snapshot.committedHeight !== null
                ? `#${snapshot.committedHeight.toLocaleString()}`
                : "n/a"}
            </span>
          </span>
        </div>
      </div>

      {/* Expanded Diagnostics Panel */}
      {open ? (
        <div className="mt-3 space-y-3 rounded-lg border border-border bg-bg p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-fg">Sanitized Support Bundle</p>
              <p className="text-[11px] text-muted">
                Schema v{snapshot.schemaVersion} · Auth tokens, cookies, and private credentials are
                stripped before export.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="copy-explorer-diagnostics-btn"
              onClick={() => void handleCopy()}
              className="h-8 gap-1.5 text-xs"
            >
              {copied ? (
                <>
                  <Check className="size-3.5 text-emerald-400" />
                  <span>Diagnostics Copied</span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  <span>Copy Diagnostics JSON</span>
                </>
              )}
            </Button>
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <DiagnosticMetric
              label="Chain ID"
              value={snapshot.chainId !== null ? String(snapshot.chainId) : "n/a"}
            />
            <DiagnosticMetric
              label="Committed Height"
              value={
                snapshot.committedHeight !== null
                  ? `#${snapshot.committedHeight.toLocaleString()}`
                  : "n/a"
              }
            />
            <DiagnosticMetric
              label="Blue Score"
              value={
                snapshot.blueScore !== null ? snapshot.blueScore.toLocaleString() : "n/a"
              }
            />
            <DiagnosticMetric
              label="Peers"
              value={snapshot.peerCount !== null ? String(snapshot.peerCount) : "n/a"}
            />
            <DiagnosticMetric
              label="Mempool"
              value={snapshot.mempoolCount !== null ? String(snapshot.mempoolCount) : "n/a"}
            />
            <DiagnosticMetric
              label="Active Tips"
              value={snapshot.tipCount !== null ? String(snapshot.tipCount) : "n/a"}
            />
          </dl>

          {/* RPC Latency Sparkline & Sync-Lag Summary */}
          <div
            data-testid="diagnostics-latency-sparkline"
            className="rounded-md border border-border/80 bg-surface/40 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-fg">RPC Latency Sparkline</span>
                <span className="font-mono text-[10px] text-subtle tabular-nums">
                  {latencySummary.count}/{DEFAULT_LATENCY_RING_CAPACITY} probes
                  {latencySummary.errorCount > 0 ? ` · ${latencySummary.errorCount} err` : ""}
                </span>
                {snapshot.networkTag ? (
                  <span className="rounded border border-border/80 bg-bg px-1.5 py-0.5 font-mono text-[10px] text-muted">
                    {snapshot.networkTag}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] tabular-nums">
                <span
                  data-testid="diagnostics-latency-p50"
                  className="inline-flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 text-fg"
                >
                  <span className="text-subtle">p50</span>
                  <span className="font-semibold">{formatLatencyMs(latencySummary.p50Ms)}</span>
                </span>
                <span
                  data-testid="diagnostics-latency-p95"
                  className="inline-flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 text-fg"
                >
                  <span className="text-subtle">p95</span>
                  <span className="font-semibold">{formatLatencyMs(latencySummary.p95Ms)}</span>
                </span>
                <span
                  data-testid="diagnostics-latency-max"
                  className="inline-flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 text-fg"
                >
                  <span className="text-subtle">max</span>
                  <span className="font-semibold">{formatLatencyMs(latencySummary.maxMs)}</span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="diagnostics-probe-refresh-btn"
                  disabled={probing || source === "mainnet"}
                  onClick={() => void runProbe()}
                  className="h-6 gap-1 px-2 text-[10px]"
                >
                  <RefreshCw className={cn("size-3", probing && "animate-spin")} />
                  <span>Probe</span>
                </Button>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-3">
              <svg
                viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
                width={SPARKLINE_WIDTH}
                height={SPARKLINE_HEIGHT}
                role="img"
                aria-label="RPC probe latency sparkline"
                className="h-9 w-40 shrink-0 overflow-visible rounded border border-border/60 bg-bg/80"
              >
                {latencySummary.points ? (
                  <polyline
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={latencySummary.points}
                    className={cn(
                      latencySummary.errorCount > 0 ? "text-amber-400" : "text-emerald-400",
                    )}
                  />
                ) : (
                  <line
                    x1="2"
                    y1={SPARKLINE_HEIGHT / 2}
                    x2={SPARKLINE_WIDTH - 2}
                    y2={SPARKLINE_HEIGHT / 2}
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    className="text-border"
                  />
                )}
              </svg>
              <div className="min-w-0 text-[11px] text-muted">
                <p className="truncate font-mono text-fg tabular-nums">
                  Last probe: {formatLatencyMs(latencySummary.lastMs)}
                </p>
                <p className="truncate text-[10px] text-subtle">
                  {syncLag.label}
                  {highestObservedHeight !== null
                    ? ` · Peak #${highestObservedHeight.toLocaleString()}`
                    : ""}
                </p>
              </div>
            </div>
          </div>

          <pre
            data-testid="explorer-diagnostics-json"
            className="max-h-56 overflow-auto rounded-md border border-border/80 bg-surface/60 p-3 font-mono text-[11px] leading-relaxed text-muted"
          >
            {formattedJson}
          </pre>
        </div>
      ) : null}
    </section>
  );
}

function DiagnosticMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-surface/40 px-2.5 py-2">
      <dt className="truncate text-[10px] font-medium tracking-wider text-subtle uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-mono text-xs font-semibold tabular-nums text-fg">
        {value}
      </dd>
    </div>
  );
}
