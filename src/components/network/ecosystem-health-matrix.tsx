import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Cpu,
  Database,
  MessageSquare,
  RefreshCw,
  Server,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { withSource } from "@/lib/api/client";
import type { ApiSource } from "@/lib/api/contract";
import {
  evaluateEcosystemHealthMatrix,
  type EcosystemHealthMatrix,
  type EcosystemHealthMatrixInput,
  type EcosystemServiceId,
  type EcosystemServiceProbeInput,
  type EcosystemServiceStatus,
} from "@/lib/network/ecosystem-health";
import { cn } from "@/lib/utils";

type EnvBag = Record<string, string | undefined>;

const PROBE_TIMEOUT_MS = 5_000;
const REFRESH_INTERVAL_MS = 30_000;

function readPublicEnv(key: string): string | null {
  const viteEnv = (import.meta as { env?: EnvBag }).env;
  const raw = viteEnv?.[key]?.trim();
  return raw ? raw : null;
}

function joinServiceUrl(base: string, path: string): string | null {
  try {
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(normalizedPath, normalizedBase);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchJsonProbe(
  url: string,
  signal: AbortSignal,
): Promise<EcosystemServiceProbeInput> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const onParentAbort = () => controller.abort();
  signal.addEventListener("abort", onParentAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }
    const payload: unknown = await response.json();
    return { payload };
  } catch (err) {
    if (signal.aborted) return { error: "Probe cancelled" };
    if (err instanceof DOMException && err.name === "AbortError") {
      return { error: "Request timed out" };
    }
    return { error: err instanceof Error ? err.message : "Service unreachable" };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onParentAbort);
  }
}

async function probeRpcService(
  source: ApiSource,
  signal: AbortSignal,
): Promise<EcosystemServiceProbeInput> {
  const explicitHealthUrl = readPublicEnv("KOVANICA_PUBLIC_RPC_HEALTH_URL");
  if (explicitHealthUrl) {
    return fetchJsonProbe(explicitHealthUrl, signal);
  }

  // Fallback to the app's own `/api/head` proxy so RPC health is live out of the box.
  const headProbe = await fetchJsonProbe(withSource("/api/head", source), signal);
  if (headProbe.error || !headProbe.payload || typeof headProbe.payload !== "object") {
    return headProbe;
  }

  const head = headProbe.payload as Record<string, unknown>;
  if (typeof head.blocks === "number" && Number.isFinite(head.blocks)) {
    return {
      payload: {
        status: "ok",
        height: head.blocks,
        rpc_version: typeof head.rpc_version === "string" ? head.rpc_version : undefined,
        mempool_pending:
          typeof head.mempool_pending === "number" ? head.mempool_pending : undefined,
      },
    };
  }
  return headProbe;
}

async function probeOptionalService(
  envKey: string,
  endpointPath: string,
  signal: AbortSignal,
): Promise<EcosystemServiceProbeInput> {
  const baseUrl = readPublicEnv(envKey);
  if (!baseUrl) {
    return { error: "Endpoint not configured" };
  }
  const url = joinServiceUrl(baseUrl, endpointPath);
  if (!url) {
    return { error: "Invalid endpoint URL" };
  }
  return fetchJsonProbe(url, signal);
}

function mainnetPrelaunchMatrix(): EcosystemHealthMatrix {
  return evaluateEcosystemHealthMatrix({
    rpc: { error: "Mainnet launching 1.1.2027" },
    indexer: { error: "Mainnet launching 1.1.2027" },
    stratum: { error: "Mainnet launching 1.1.2027" },
    comms: { error: "Mainnet launching 1.1.2027" },
  });
}

function serviceIcon(id: EcosystemServiceId) {
  switch (id) {
    case "rpc":
      return Server;
    case "indexer":
      return Database;
    case "stratum":
      return Cpu;
    case "comms":
      return MessageSquare;
  }
}

function statusPillTone(status: EcosystemServiceStatus): string {
  if (status === "healthy") return "border-ok/40 bg-ok/10 text-ok";
  if (status === "degraded") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-danger/40 bg-danger/10 text-danger";
}

function statusDotTone(status: EcosystemServiceStatus): string {
  if (status === "healthy") return "bg-ok";
  if (status === "degraded") return "bg-amber-400";
  return "bg-danger";
}

function statusLabel(status: EcosystemServiceStatus): string {
  if (status === "healthy") return "Healthy";
  if (status === "degraded") return "Degraded";
  return "Offline";
}

export interface EcosystemHealthMatrixProps {
  source: ApiSource;
  /** Optional pre-evaluated matrix (disables live client probing when provided). */
  matrix?: EcosystemHealthMatrix;
}

export function EcosystemHealthMatrix({ source, matrix: controlledMatrix }: EcosystemHealthMatrixProps) {
  const [liveMatrix, setLiveMatrix] = useState<EcosystemHealthMatrix>(() =>
    source === "mainnet"
      ? mainnetPrelaunchMatrix()
      : evaluateEcosystemHealthMatrix({
          rpc: { error: "Probing…" },
          indexer: { error: "Probing…" },
          stratum: { error: "Probing…" },
          comms: { error: "Probing…" },
        }),
  );
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const runProbe = useCallback(async () => {
    if (controlledMatrix) return;
    if (source === "mainnet") {
      setLiveMatrix(mainnetPrelaunchMatrix());
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    try {
      const [rpc, indexer, stratum, comms] = await Promise.all([
        probeRpcService(source, controller.signal),
        probeOptionalService("KOVANICA_PUBLIC_INDEXER_URL", "/integrity", controller.signal),
        probeOptionalService("KOVANICA_PUBLIC_STRATUM_URL", "/workers", controller.signal),
        probeOptionalService("KOVANICA_PUBLIC_COMMS_URL", "/v1/health", controller.signal),
      ]);

      if (!controller.signal.aborted) {
        const input: EcosystemHealthMatrixInput = { rpc, indexer, stratum, comms };
        setLiveMatrix(evaluateEcosystemHealthMatrix(input));
      }
    } finally {
      if (abortRef.current === controller) {
        setBusy(false);
      }
    }
  }, [controlledMatrix, source]);

  useEffect(() => {
    if (controlledMatrix) return;
    void runProbe();
    if (source === "mainnet") return;

    const timer = setInterval(() => void runProbe(), REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [controlledMatrix, runProbe, source]);

  const matrix = controlledMatrix ?? liveMatrix;

  const OverallIcon =
    matrix.overall === "healthy"
      ? ShieldCheck
      : matrix.overall === "degraded"
        ? AlertTriangle
        : XCircle;

  return (
    <section
      data-testid="ecosystem-health-matrix"
      data-matrix-overall={matrix.overall}
      aria-label="Ecosystem Services Health Matrix"
      className="mx-auto w-full max-w-3xl px-4 pt-6 md:px-6"
    >
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-mono text-[10px] tracking-brand text-gold uppercase">
              Ecosystem Services Health Matrix
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Unified probe status across RPC Node, Indexer, Stratum Gateway, and Comms Relay.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              data-testid="ecosystem-health-overall"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium",
                statusPillTone(matrix.overall),
              )}
            >
              <OverallIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {statusLabel(matrix.overall)} · {matrix.healthyCount}/{matrix.totalCount}
              </span>
            </span>
            {!controlledMatrix && source !== "mainnet" && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-7"
                disabled={busy}
                onClick={() => void runProbe()}
                aria-label="Refresh ecosystem services health"
              >
                <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {matrix.services.map((service) => {
            const Icon = serviceIcon(service.id);
            return (
              <article
                key={service.id}
                data-testid={`ecosystem-service-${service.id}`}
                data-service-status={service.status}
                className="flex flex-col justify-between rounded-lg border border-border bg-bg/60 p-3.5"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                      <div>
                        <h2 className="text-sm font-medium text-fg">{service.name}</h2>
                        <p className="font-mono text-[10px] text-subtle">{service.endpoint}</p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
                        statusPillTone(service.status),
                      )}
                    >
                      <span
                        className={cn("size-1.5 rounded-full", statusDotTone(service.status))}
                        aria-hidden="true"
                      />
                      <span>{statusLabel(service.status)}</span>
                    </span>
                  </div>

                  <p className="mt-2 font-mono text-xs text-fg">{service.summary}</p>

                  <dl className="mt-3 space-y-1.5 border-t border-border/70 pt-2.5 text-xs">
                    {service.metrics.map((metric) => (
                      <div key={metric.label} className="flex items-center justify-between gap-2">
                        <dt className="text-[11px] text-muted">{metric.label}</dt>
                        <dd
                          className={cn(
                            "truncate text-right text-fg",
                            metric.mono && "font-mono text-[11px]",
                          )}
                        >
                          {metric.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {service.detail && (
                  <p className="mt-2.5 truncate border-t border-border/50 pt-2 font-mono text-[10px] text-subtle">
                    {service.detail}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
