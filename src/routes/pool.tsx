import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { PoolView } from "@/components/protocol/pool-view";
import { useApiSource } from "@/lib/api/client";
import { POOL_FROZEN_SPEC, summarizePoolStratumConfig } from "@/lib/pool/stratum-summary";

function PoolPage() {
  const source = useApiSource();
  const activeNetwork = source === "mainnet" ? "mainnet" : "testnet";
  const summary = summarizePoolStratumConfig(activeNetwork);

  return (
    <Shell>
      <section
        data-testid="pool-stratum-spec-strip"
        data-stratum-network={summary.network}
        aria-label="Stratum TLS & Frozen Emission Spec"
        className="border-b border-border bg-surface/80 px-4 py-3 backdrop-blur-sm"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[10px] tracking-brand text-gold uppercase">
              Stratum Mining Pool · TLS &amp; Frozen Emission Spec
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/pools"
                className="font-mono text-[11px] text-teal hover:underline"
              >
                Looking for AMM Liquidity Pools? → /pools
              </Link>
              <span
                data-testid="pool-stratum-tls-badge"
                className="inline-flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-ok"
              >
                <Lock className="size-3 shrink-0" aria-hidden="true" />
                <span>{summary.protocol} · TLS required</span>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 font-mono text-[11px] text-fg">
              <span className="text-muted">Mainnet (Chain 1)</span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-gold">{POOL_FROZEN_SPEC.mainnetTag}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue/30 bg-blue/10 px-2.5 py-0.5 font-mono text-[11px] text-fg">
              <span className="text-muted">Testnet (Chain 2)</span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-blue">{POOL_FROZEN_SPEC.testnetTag}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-0.5 font-mono text-[11px] text-muted">
              <span>{POOL_FROZEN_SPEC.powAlgorithm}</span>
              <span aria-hidden="true">·</span>
              <span>{POOL_FROZEN_SPEC.ghostdag}</span>
              <span aria-hidden="true">·</span>
              <span>{POOL_FROZEN_SPEC.targetBlockTime}</span>
              <span aria-hidden="true">·</span>
              <span className="text-fg">{POOL_FROZEN_SPEC.initialBlockReward}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted">
            <span className="rounded-md border border-border bg-bg px-2 py-0.5">
              Era: {POOL_FROZEN_SPEC.subsidyEraBlocks.toLocaleString("en-US")} blocks ({POOL_FROZEN_SPEC.decayFactor} decay)
            </span>
            <span className="rounded-md border border-border bg-bg px-2 py-0.5">
              Fees: {POOL_FROZEN_SPEC.feeSplit}
            </span>
            <span className="rounded-md border border-border bg-bg px-2 py-0.5">
              VarDiff: {summary.varDiffMode} · Drain: {summary.gracefulDrainMethod}
            </span>
          </div>
        </div>
      </section>

      <PoolView />
    </Shell>
  );
}

export const Route = createFileRoute("/pool")({ component: PoolPage });
