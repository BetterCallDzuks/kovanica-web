import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Radio,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { ApiSource, ApiState } from "@/lib/api/contract";
import type { LiveStreamTransport } from "@/lib/api/ws-stream";
import {
  buildExplorerDiagnosticsSnapshot,
  formatDiagnosticsJson,
} from "@/lib/explorer/diagnostics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

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
