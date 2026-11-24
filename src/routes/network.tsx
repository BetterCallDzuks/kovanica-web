import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, AlertTriangle, XCircle } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { EcosystemHealthMatrix } from "@/components/network/ecosystem-health-matrix";
import { NetworkView } from "@/components/network/network-view";
import { useApiSource } from "@/lib/api/client";
import type { ApiSource } from "@/lib/api/contract";
import {
  CANONICAL_NETWORK_IDENTITIES,
  FROZEN_CONSENSUS_CONSTANTS,
  evaluateServiceReadiness,
  type ServiceReadinessInput,
  type ServiceReadinessStatus,
} from "@/lib/network/readiness";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/network")({
  component: NetworkPage,
});

function ecosystemServicesFor(source: ApiSource): readonly ServiceReadinessInput[] {
  if (source === "mainnet") {
    return [
      { name: "Mainnet RPC (Chain 1)", status: "offline", detail: "Launching 1.1.2027" },
      { name: "Mainnet Explorer", status: "offline", detail: "Prelaunch" },
      { name: "Consensus Spec", status: "operational", detail: "Frozen" },
    ];
  }
  if (source === "local") {
    return [
      { name: "Local Node", status: "operational", detail: "In-memory" },
      { name: "BlockDAG Explorer", status: "operational", detail: "Local mode" },
      { name: "Consensus Spec", status: "operational", detail: "Frozen" },
    ];
  }
  return [
    { name: "Testnet RPC (seed1)", status: "operational", detail: "Chain 2" },
    { name: "BlockDAG Explorer", status: "operational", detail: "Live" },
    { name: "Testnet Faucet", status: "operational", detail: "PRO-21" },
  ];
}

function statusBadgeTone(status: ServiceReadinessStatus): string {
  if (status === "operational") {
    return "border-ok/40 bg-ok/10 text-ok";
  }
  if (status === "degraded") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  }
  return "border-danger/40 bg-danger/10 text-danger";
}

function statusDotTone(status: ServiceReadinessStatus): string {
  if (status === "operational") return "bg-ok";
  if (status === "degraded") return "bg-amber-400";
  return "bg-danger";
}

function statusLabel(status: ServiceReadinessStatus): string {
  if (status === "operational") return "Operational";
  if (status === "degraded") return "Degraded";
  return "Offline";
}

function NetworkPage() {
  const source = useApiSource();
  const services = ecosystemServicesFor(source);
  const report = evaluateServiceReadiness(services);

  const OverallIcon =
    report.overall === "operational"
      ? ShieldCheck
      : report.overall === "degraded"
        ? AlertTriangle
        : XCircle;

  return (
    <Shell>
      <section
        data-testid="network-canonical-readiness-strip"
        data-readiness-overall={report.overall}
        aria-label="Canonical Network Identities & Ecosystem Services"
        className="border-b border-border bg-surface/80 px-4 py-3 backdrop-blur-sm"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[10px] tracking-brand text-gold uppercase">
              Canonical Network Identities &amp; Ecosystem Services
            </p>
            <span
              data-testid="network-readiness-overall"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium",
                statusBadgeTone(report.overall),
              )}
            >
              <OverallIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {statusLabel(report.overall)} · {report.healthyCount}/{report.totalCount}
              </span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 font-mono text-[11px] text-fg">
              <span className="text-muted">{CANONICAL_NETWORK_IDENTITIES.mainnet.label}</span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-gold">
                {CANONICAL_NETWORK_IDENTITIES.mainnet.networkTag}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue/30 bg-blue/10 px-2.5 py-0.5 font-mono text-[11px] text-fg">
              <span className="text-muted">{CANONICAL_NETWORK_IDENTITIES.testnet.label}</span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-blue">
                {CANONICAL_NETWORK_IDENTITIES.testnet.networkTag}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-0.5 font-mono text-[11px] text-muted">
              <span>{FROZEN_CONSENSUS_CONSTANTS.powAlgorithm}</span>
              <span aria-hidden="true">·</span>
              <span>{FROZEN_CONSENSUS_CONSTANTS.ghostdag}</span>
              <span aria-hidden="true">·</span>
              <span>{FROZEN_CONSENSUS_CONSTANTS.targetBlockTime}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {services.map((service) => (
              <span
                key={service.name}
                data-service-status={service.status}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px]",
                  statusBadgeTone(service.status),
                )}
              >
                <span
                  className={cn("size-1.5 rounded-full", statusDotTone(service.status))}
                  aria-hidden="true"
                />
                <span>{service.name}</span>
                {service.detail && (
                  <span className="text-[10px] opacity-80">({service.detail})</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </section>

      <EcosystemHealthMatrix source={source} />

      <NetworkView />
    </Shell>
  );
}
