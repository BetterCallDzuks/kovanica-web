import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Compass, FileText, Lock, Pickaxe } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { MinerCommandBuilder } from "@/components/explorer/miner-command-builder";
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

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <header className="flex flex-col gap-2 border-b border-border pb-5">
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-brand text-gold uppercase">
            <Pickaxe className="size-3.5 shrink-0" aria-hidden="true" />
            <span>KovanicaHash PoW · Stratum V1 TLS</span>
          </div>
          <h1 className="font-display text-3xl tracking-tight text-fg italic md:text-4xl">
            Mining Pool
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Connect CPU or GPU miners over encrypted Stratum V1 TLS or solo RPC. Configure your
            PRO-21 payout address, worker name, and thread count below to generate a validated{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">
              kovanica mine
            </code>{" "}
            command.
          </p>
        </header>

        <MinerCommandBuilder defaultOpen={true} defaultNetwork={activeNetwork} />

        <section
          aria-label="Mining telemetry links"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          <Link
            to="/explorer"
            className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-gold/40 hover:bg-surface-2"
          >
            <Compass className="mt-0.5 size-4 shrink-0 text-blue" />
            <div>
              <div className="text-sm font-medium text-fg">BlockDAG Explorer</div>
              <div className="mt-0.5 text-xs text-muted">
                Live hashrate, difficulty &amp; recent mined blocks
              </div>
            </div>
          </Link>
          <Link
            to="/network"
            className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-gold/40 hover:bg-surface-2"
          >
            <Activity className="mt-0.5 size-4 shrink-0 text-blue" />
            <div>
              <div className="text-sm font-medium text-fg">Network Telemetry</div>
              <div className="mt-0.5 text-xs text-muted">
                Connected peers, seeds &amp; sync health
              </div>
            </div>
          </Link>
          <Link
            to="/docs"
            className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-gold/40 hover:bg-surface-2"
          >
            <FileText className="mt-0.5 size-4 shrink-0 text-blue" />
            <div>
              <div className="text-sm font-medium text-fg">Mining &amp; CLI Docs</div>
              <div className="mt-0.5 text-xs text-muted">
                Stratum TLS flags, certificates &amp; solo setup
              </div>
            </div>
          </Link>
        </section>
      </main>
    </Shell>
  );
}

export const Route = createFileRoute("/pool")({ component: PoolPage });
