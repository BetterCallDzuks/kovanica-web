import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp, ArrowLeft, Layers, Settings2, Zap, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATOM, FIXED_FEES, TOKEN } from "@/lib/networkConstants";
import {
  DEFAULT_DEX_POOLS,
  buildWaveASwapBatchPlan,
  computeSwapQuote,
  formatTokenUnits,
  parseTokenUnits,
} from "@/lib/amm/math";
import { toast } from "sonner";

export const Route = createFileRoute("/swap")({
  component: SwapPage,
});

const SLIPPAGE_PRESETS_BPS = [
  { label: "0.1%", bps: 10 },
  { label: "0.5%", bps: 50 },
  { label: "1.0%", bps: 100 },
] as const;

function SwapPage() {
  const [selectedPoolId, setSelectedPoolId] = useState(DEFAULT_DEX_POOLS[0]!.id);
  const [zeroForOne, setZeroForOne] = useState(true);
  const [amountInStr, setAmountInStr] = useState("100");
  const [slippageBps, setSlippageBps] = useState<number>(50);
  const [customSlippage, setCustomSlippage] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Live Wave B dynamic base fee & storage deposit telemetry
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

  const pool = useMemo(
    () => DEFAULT_DEX_POOLS.find((p) => p.id === selectedPoolId) ?? DEFAULT_DEX_POOLS[0]!,
    [selectedPoolId],
  );

  const tokenIn = zeroForOne ? pool.token0 : pool.token1;
  const tokenOut = zeroForOne ? pool.token1 : pool.token0;
  const reserveIn = zeroForOne ? pool.reserve0 : pool.reserve1;
  const reserveOut = zeroForOne ? pool.reserve1 : pool.reserve0;

  const amountInRaw = useMemo(
    () => parseTokenUnits(amountInStr, tokenIn.decimals),
    [amountInStr, tokenIn.decimals],
  );

  const quote = useMemo(() => {
    if (!amountInRaw || amountInRaw <= 0n) return null;
    return computeSwapQuote(amountInRaw, reserveIn, reserveOut, slippageBps);
  }, [amountInRaw, reserveIn, reserveOut, slippageBps]);

  const batchSteps = useMemo(() => {
    if (!amountInRaw || !quote) return [];
    return buildWaveASwapBatchPlan({
      poolId: pool.id,
      tokenIn,
      tokenOut,
      amountIn: amountInRaw,
      minAmountOut: quote.minAmountOut,
    });
  }, [amountInRaw, pool.id, quote, tokenIn, tokenOut]);

  const handleExecuteSwap = async () => {
    if (!amountInRaw || !quote) {
      toast.error("Enter a valid positive swap amount");
      return;
    }
    setSubmitting(true);
    try {
      const kovanicaProvider = (
        window as unknown as {
          kovanica?: {
            signBatchTransaction?: (payload: unknown) => Promise<{ rawHex?: string; txHash?: string }>;
          };
        }
      ).kovanica;

      if (kovanicaProvider?.signBatchTransaction) {
        await kovanicaProvider.signBatchTransaction({
          actions: batchSteps,
          feeAtoms: String(baseFeeAtoms * 350 + FIXED_FEES.rwa_mint),
        });
        toast.success(
          `Signed Wave A atomic batch (${batchSteps.length} step${batchSteps.length > 1 ? "s" : ""}) via window.kovanica`,
        );
      } else {
        toast.success(
          `Prepared 1-tx Wave A atomic Batch: ${batchSteps.map((s) => s.method).join(" → ")} (min out ${formatTokenUnits(quote.minAmountOut, tokenOut.decimals)} ${tokenOut.symbol})`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Swap execution failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:px-6 md:py-8 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/wallet" className="text-muted hover:text-fg transition-colors">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-wide text-emerald-400 uppercase">
              Native AMM / DEX · Constant Product (0.30% LP Fee)
            </p>
            <h1 className="font-display text-2xl tracking-tight text-fg">Kovanica Swap</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/pools">
            <Button variant="outline" size="sm" className="text-xs">
              <Layers className="size-3.5 mr-1.5" />
              Pools
            </Button>
          </Link>
          <Button
            variant={showSettings ? "default" : "outline"}
            size="sm"
            onClick={() => setShowSettings((v) => !v)}
            aria-label="Slippage settings"
          >
            <Settings2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Live Wave B Fee Banner */}
      <div className="rounded-lg border border-border bg-surface/60 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Wave B Base Fee: <strong className="font-mono text-fg">{baseFeeAtoms} atoms/byte</strong>
        </span>
        <span>
          Storage Deposit:{" "}
          <strong className="font-mono text-fg">
            {(depositPerByteAtoms / ATOM).toFixed(4)} {TOKEN}/byte
          </strong>
        </span>
        <span>
          Batch Fee Floor:{" "}
          <strong className="font-mono text-fg">
            {(FIXED_FEES.rwa_mint / ATOM).toFixed(4)} {TOKEN}
          </strong>
        </span>
      </div>

      {showSettings && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-fg">Slippage Tolerance (`min_out` guard)</span>
            <span className="font-mono text-xs text-muted">{(slippageBps / 100).toFixed(2)}%</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {SLIPPAGE_PRESETS_BPS.map((p) => (
              <Button
                key={p.bps}
                size="sm"
                variant={slippageBps === p.bps ? "default" : "outline"}
                onClick={() => {
                  setSlippageBps(p.bps);
                  setCustomSlippage("");
                }}
                className="text-xs"
              >
                {p.label}
              </Button>
            ))}
            <input
              value={customSlippage}
              onChange={(e) => {
                setCustomSlippage(e.target.value);
                const parsed = Number.parseFloat(e.target.value);
                if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 50) {
                  setSlippageBps(Math.round(parsed * 100));
                }
              }}
              placeholder="Custom %"
              className="h-8 w-24 rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg"
            />
          </div>
        </div>
      )}

      {/* Swap Card */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <div>
          <label className="text-xs text-muted block mb-1.5">Active Liquidity Pool</label>
          <select
            value={selectedPoolId}
            onChange={(e) => setSelectedPoolId(e.target.value)}
            className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
          >
            {DEFAULT_DEX_POOLS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.token0.symbol} / {p.token1.symbol} — TVL ${p.tvlUsd.toLocaleString("en-US")}
              </option>
            ))}
          </select>
        </div>

        {/* Sell Input */}
        <div className="rounded-lg border border-border bg-bg p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>You Pay</span>
            <span className="font-mono">
              Reserve: {formatTokenUnits(reserveIn, tokenIn.decimals)} {tokenIn.symbol}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              value={amountInStr}
              onChange={(e) => setAmountInStr(e.target.value)}
              placeholder="0.0"
              className="flex-1 bg-transparent font-mono text-2xl text-fg focus:outline-none"
            />
            <span className="rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm font-medium text-fg">
              {tokenIn.symbol}
            </span>
          </div>
        </div>

        <div className="flex justify-center -my-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZeroForOne((v) => !v)}
            aria-label="Flip swap direction"
            className="rounded-full"
          >
            <ArrowDownUp className="size-4" />
          </Button>
        </div>

        {/* Buy Output */}
        <div className="rounded-lg border border-border bg-bg p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>You Receive (Estimated)</span>
            <span className="font-mono">
              Reserve: {formatTokenUnits(reserveOut, tokenOut.decimals)} {tokenOut.symbol}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 font-mono text-2xl text-fg">
              {quote ? formatTokenUnits(quote.amountOut, tokenOut.decimals, 6) : "0.0"}
            </div>
            <span className="rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm font-medium text-fg">
              {tokenOut.symbol}
            </span>
          </div>
        </div>

        {/* Quote Details */}
        {quote && (
          <div className="rounded-lg border border-border/70 bg-bg/60 p-3 space-y-1.5 text-xs">
            <div className="flex justify-between text-muted">
              <span>LP Fee (0.30%)</span>
              <span className="font-mono text-fg">
                {formatTokenUnits(quote.feeAmount, tokenIn.decimals, 6)} {tokenIn.symbol}
              </span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Price Impact</span>
              <span
                className={
                  quote.priceImpactPct > 3
                    ? "font-mono text-amber-400"
                    : "font-mono text-emerald-400"
                }
              >
                {quote.priceImpactPct.toFixed(3)}%
              </span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Minimum Received ({(slippageBps / 100).toFixed(2)}% slippage)</span>
              <span className="font-mono text-fg">
                {formatTokenUnits(quote.minAmountOut, tokenOut.decimals, 6)} {tokenOut.symbol}
              </span>
            </div>
          </div>
        )}

        {/* Wave A Atomic Batch Preview */}
        {batchSteps.length > 0 && (
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-purple-400">
              <Zap className="size-3.5" />
              <span>1-Tx Wave A Atomic Batch ({batchSteps.length} actions)</span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-xs text-muted font-mono">
              {batchSteps.map((step, i) => (
                <li key={`${step.method}-${i}`}>
                  <span className="text-fg">{step.method}</span> — {step.description}
                </li>
              ))}
            </ol>
          </div>
        )}

        <Button
          className="w-full h-11"
          disabled={!quote || submitting}
          onClick={handleExecuteSwap}
        >
          <ShieldCheck className="size-4 mr-2" />
          {submitting
            ? "Signing Wave A Batch…"
            : tokenIn.isNative
              ? `Swap ${tokenIn.symbol} → ${tokenOut.symbol}`
              : `Approve & Swap ${tokenIn.symbol} → ${tokenOut.symbol} (1-Tx Batch)`}
        </Button>
      </div>
    </div>
  );
}
