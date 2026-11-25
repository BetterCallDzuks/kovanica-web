import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowLeftRight, Plus, Minus, Zap, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATOM, FIXED_FEES, TOKEN } from "@/lib/networkConstants";
import {
  DEFAULT_DEX_POOLS,
  buildWaveAAddLiquidityBatchPlan,
  estimatePoolAprPct,
  formatTokenUnits,
  parseTokenUnits,
} from "@/lib/amm/math";
import { toast } from "sonner";

export const Route = createFileRoute("/pools")({
  component: PoolsPage,
});

function PoolsPage() {
  const [selectedPoolId, setSelectedPoolId] = useState(DEFAULT_DEX_POOLS[0]!.id);
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount0Str, setAmount0Str] = useState("1000");
  const [amount1Str, setAmount1Str] = useState("500");
  const [lpRemoveStr, setLpRemoveStr] = useState("100000");

  // Live Wave B base fee & storage deposit
  const [baseFeeAtoms, setBaseFeeAtoms] = useState<number>(1);
  const [depositPerByteAtoms, setDepositPerByteAtoms] = useState<number>(100_000);

  useEffect(() => {
    let active = true;
    fetch("/api/base_fee")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Record<string, unknown> | null) => {
        if (!active || !data) return;
        const parseHex = (v: unknown, fallback: number) =>
          typeof v === "string" && v.startsWith("0x")
            ? Number.parseInt(v, 16) || fallback
            : Number(v) || fallback;
        setBaseFeeAtoms(parseHex(data.base_fee_per_byte, 1));
        setDepositPerByteAtoms(parseHex(data.storage_deposit_per_byte, 100_000));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const selectedPool = useMemo(
    () => DEFAULT_DEX_POOLS.find((p) => p.id === selectedPoolId) ?? DEFAULT_DEX_POOLS[0]!,
    [selectedPoolId],
  );

  const amount0Raw = useMemo(
    () => parseTokenUnits(amount0Str, selectedPool.token0.decimals),
    [amount0Str, selectedPool.token0.decimals],
  );
  const amount1Raw = useMemo(
    () => parseTokenUnits(amount1Str, selectedPool.token1.decimals),
    [amount1Str, selectedPool.token1.decimals],
  );

  const addBatchSteps = useMemo(() => {
    if (!amount0Raw || !amount1Raw || amount0Raw <= 0n || amount1Raw <= 0n) return [];
    return buildWaveAAddLiquidityBatchPlan({
      pool: selectedPool,
      amount0: amount0Raw,
      amount1: amount1Raw,
    });
  }, [amount0Raw, amount1Raw, selectedPool]);

  const handleAddLiquidity = async () => {
    if (!amount0Raw || !amount1Raw || amount0Raw <= 0n || amount1Raw <= 0n) {
      toast.error("Enter valid positive amounts for both tokens");
      return;
    }
    const kovanicaProvider = (
      window as unknown as {
        kovanica?: {
          signBatchTransaction?: (payload: unknown) => Promise<unknown>;
        };
      }
    ).kovanica;
    try {
      if (kovanicaProvider?.signBatchTransaction) {
        await kovanicaProvider.signBatchTransaction({
          actions: addBatchSteps,
          feeAtoms: String(baseFeeAtoms * 400 + FIXED_FEES.rwa_mint),
        });
        toast.success(`Signed Wave A atomic liquidity batch (${addBatchSteps.length} actions)`);
      } else {
        toast.success(
          `Prepared 1-tx Wave A Batch (${addBatchSteps.map((s) => s.method).join(" → ")}) for ${selectedPool.token0.symbol}/${selectedPool.token1.symbol}`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Add liquidity failed");
    }
  };

  const handleRemoveLiquidity = () => {
    if (!lpRemoveStr.trim() || !/^\d+$/.test(lpRemoveStr.trim())) {
      toast.error("Enter a valid integer LP share amount");
      return;
    }
    toast.success(
      `Prepared amm_remove_liquidity (${lpRemoveStr} LP shares) on ${selectedPool.token0.symbol}/${selectedPool.token1.symbol}`,
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/wallet" className="text-muted hover:text-fg transition-colors">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-wide text-emerald-400 uppercase">
              Native AMM Liquidity · x · y = k
            </p>
            <h1 className="font-display text-2xl tracking-tight text-fg">Liquidity Pools</h1>
          </div>
        </div>
        <Link to="/swap">
          <Button size="sm" className="text-xs">
            <ArrowLeftRight className="size-3.5 mr-1.5" />
            Open Swap
          </Button>
        </Link>
      </div>

      {/* Live Wave B Fee Banner */}
      <div className="rounded-lg border border-border bg-surface/60 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Wave B Base Fee: <strong className="font-mono text-fg">{baseFeeAtoms} atoms/byte</strong>
        </span>
        <span>
          Refundable Storage Deposit:{" "}
          <strong className="font-mono text-fg">
            {(depositPerByteAtoms / ATOM).toFixed(4)} {TOKEN}/byte
          </strong>
        </span>
        <span>
          LP Swap Fee: <strong className="font-mono text-emerald-400">0.30% (100% to LPs)</strong>
        </span>
      </div>

      {/* Pool Reserves & APR Table */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-bg/60 text-muted font-mono uppercase text-[10px]">
              <tr>
                <th className="px-4 py-3">Pair</th>
                <th className="px-4 py-3">Reserves</th>
                <th className="px-4 py-3 text-right">TVL</th>
                <th className="px-4 py-3 text-right">24h Volume</th>
                <th className="px-4 py-3 text-right">Est. APR</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {DEFAULT_DEX_POOLS.map((pool) => {
                const apr = estimatePoolAprPct(pool.volume24hUsd, pool.tvlUsd, pool.feeBps);
                const active = pool.id === selectedPoolId;
                return (
                  <tr
                    key={pool.id}
                    className={active ? "bg-purple-500/10" : "hover:bg-bg/40 transition-colors"}
                  >
                    <td className="px-4 py-3 font-medium text-fg">
                      {pool.token0.symbol} / {pool.token1.symbol}
                    </td>
                    <td className="px-4 py-3 font-mono text-muted">
                      {formatTokenUnits(pool.reserve0, pool.token0.decimals, 2)}{" "}
                      {pool.token0.symbol} +{" "}
                      {formatTokenUnits(pool.reserve1, pool.token1.decimals, 2)}{" "}
                      {pool.token1.symbol}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-fg">
                      ${pool.tvlUsd.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted">
                      ${pool.volume24hUsd.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-400">
                      <span className="inline-flex items-center gap-1">
                        <TrendingUp className="size-3" />
                        {apr.toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => setSelectedPoolId(pool.id)}
                        className="text-xs h-7"
                      >
                        {active ? "Selected" : "Manage"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Remove Liquidity Panel */}
      <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-fg">
            Manage {selectedPool.token0.symbol} / {selectedPool.token1.symbol} Liquidity
          </h2>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "add" ? "default" : "outline"}
              onClick={() => setMode("add")}
              className="text-xs"
            >
              <Plus className="size-3.5 mr-1" />
              Add Liquidity
            </Button>
            <Button
              size="sm"
              variant={mode === "remove" ? "default" : "outline"}
              onClick={() => setMode("remove")}
              className="text-xs"
            >
              <Minus className="size-3.5 mr-1" />
              Remove Liquidity
            </Button>
          </div>
        </div>

        {mode === "add" ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted block mb-1">
                  {selectedPool.token0.symbol} Deposit Amount
                </label>
                <input
                  value={amount0Str}
                  onChange={(e) => setAmount0Str(e.target.value)}
                  className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">
                  {selectedPool.token1.symbol} Deposit Amount
                </label>
                <input
                  value={amount1Str}
                  onChange={(e) => setAmount1Str(e.target.value)}
                  className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
                />
              </div>
            </div>

            {addBatchSteps.length > 0 && (
              <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-purple-400">
                  <Zap className="size-3.5" />
                  <span>1-Tx Wave A Atomic Batch ({addBatchSteps.length} actions)</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-xs text-muted font-mono">
                  {addBatchSteps.map((step, i) => (
                    <li key={`${step.method}-${i}`}>
                      <span className="text-fg">{step.method}</span> — {step.description}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <Button className="w-full" onClick={handleAddLiquidity}>
              Approve &amp; Add Liquidity (1-Tx Wave A Batch)
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted block mb-1">LP Shares to Burn (raw units)</label>
              <input
                value={lpRemoveStr}
                onChange={(e) => setLpRemoveStr(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <Button className="w-full" variant="outline" onClick={handleRemoveLiquidity}>
              Burn LP &amp; Withdraw Reserves
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
