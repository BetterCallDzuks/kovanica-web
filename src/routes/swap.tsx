import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Layers,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Shell } from "@/components/layout/shell";
import { api, useApiSource } from "@/lib/api/client";
import { shortId } from "@/lib/ledger/hash";
import { useLedger } from "@/lib/ledger/store";
import { ATOM, FIXED_FEES, TOKEN } from "@/lib/networkConstants";
import {
  DEFAULT_DEX_POOLS,
  buildWaveASwapBatchPlan,
  classifyPriceImpact,
  computeSwapQuote,
  formatTokenUnits,
  parseTokenUnits,
} from "@/lib/amm/math";
import { computeSwapInterfaceFee, getSwapInterfaceFeeConfig } from "@/lib/monetization";
import { formatTokenAmount, parseTokenAmount } from "@/lib/tokens/codec";
import { resolveTokenIcon } from "@/lib/tokens/icons";
import {
  priceImpactBps as computeKvpPriceImpactBps,
  quote as computeKvpPoolQuote,
  type ApiPool,
} from "@/lib/tokens/pool";
import {
  connectExtensionSigner,
  executeTokenBuy,
  executeTokenSell,
  getKovanicaExtension,
  getWatchedTokenContracts,
  webWalletSigner,
  type ActiveSigner,
  type AmmCallResult,
} from "@/lib/wallet/tx-builder";
import { toast } from "sonner";

export const Route = createFileRoute("/swap")({
  component: SwapPage,
});

const KVNC_DECIMALS = 9;

const SLIPPAGE_PRESETS_BPS = [
  { label: "0.1%", bps: 10 },
  { label: "0.5%", bps: 50 },
  { label: "1.0%", bps: 100 },
] as const;

function SwapPage() {
  const source = useApiSource();
  const wallet = useLedger((s) => s.wallet);

  // Live on-chain KVP-102 pools from /api/pools
  const [livePools, setLivePools] = useState<ApiPool[]>([]);
  const [loadingPools, setLoadingPools] = useState(false);

  // Selection: either `live:<contractAddress>` or a reference pool id from DEFAULT_DEX_POOLS
  const [selectedPoolId, setSelectedPoolId] = useState<string>(DEFAULT_DEX_POOLS[0]!.id);
  const [zeroForOne, setZeroForOne] = useState(true);
  const [amountInStr, setAmountInStr] = useState("10");
  const [slippageBps, setSlippageBps] = useState<number>(50);
  const [customSlippage, setCustomSlippage] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  // Signer & execution state
  const [extSigner, setExtSigner] = useState<ActiveSigner | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [swapStatus, setSwapStatus] = useState<string | null>(null);
  const [lastSwap, setLastSwap] = useState<AmmCallResult | null>(null);
  const [recentSwaps, setRecentSwaps] = useState<
    Array<{
      poolId: string;
      txHash: string;
      method: string;
      inLabel: string;
      outLabel: string;
      timestamp: string;
    }>
  >([]);

  // Live Wave B dynamic base fee & storage deposit telemetry
  const [baseFeeAtoms, setBaseFeeAtoms] = useState<number>(1);
  const [depositPerByteAtoms, setDepositPerByteAtoms] = useState<number>(100_000);

  const unlockedSigner = useMemo(() => webWalletSigner(wallet), [wallet]);
  const activeSigner = unlockedSigner ?? extSigner;
  const hasExtension = useMemo(() => getKovanicaExtension() !== null, []);

  const fetchLivePools = useCallback(async () => {
    if (source === "mainnet") {
      setLivePools([]);
      return;
    }
    setLoadingPools(true);
    try {
      const watched = getWatchedTokenContracts();
      const suffix = watched.length ? `?watched=${encodeURIComponent(watched.join(","))}` : "";
      const rows = await api<ApiPool[]>(`/api/pools${suffix}`);
      if (Array.isArray(rows)) {
        setLivePools(rows);
        if (rows.length > 0) {
          setSelectedPoolId((current) => {
            if (current.startsWith("live:")) {
              const addr = current.slice("live:".length);
              if (rows.some((r) => r.address === addr)) return current;
            }
            return `live:${rows[0]!.address}`;
          });
        }
      }
    } catch {
      // keep reference pools usable if node is offline
    } finally {
      setLoadingPools(false);
    }
  }, [source]);

  useEffect(() => {
    void fetchLivePools();
  }, [fetchLivePools]);

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

  const selectedLivePool = useMemo(() => {
    if (!selectedPoolId.startsWith("live:")) return null;
    const addr = selectedPoolId.slice("live:".length);
    return livePools.find((p) => p.address === addr) ?? null;
  }, [livePools, selectedPoolId]);

  const refPool = useMemo(
    () => DEFAULT_DEX_POOLS.find((p) => p.id === selectedPoolId) ?? DEFAULT_DEX_POOLS[0]!,
    [selectedPoolId],
  );

  // Unified display & quote fields across live KVP-102 pools and reference pools
  const tokenIn = useMemo(() => {
    if (selectedLivePool) {
      return zeroForOne
        ? { symbol: TOKEN, decimals: KVNC_DECIMALS, isNative: true }
        : { symbol: selectedLivePool.symbol, decimals: selectedLivePool.decimals, isNative: false };
    }
    return zeroForOne ? refPool.token0 : refPool.token1;
  }, [refPool, selectedLivePool, zeroForOne]);

  const tokenOut = useMemo(() => {
    if (selectedLivePool) {
      return zeroForOne
        ? { symbol: selectedLivePool.symbol, decimals: selectedLivePool.decimals, isNative: false }
        : { symbol: TOKEN, decimals: KVNC_DECIMALS, isNative: true };
    }
    return zeroForOne ? refPool.token1 : refPool.token0;
  }, [refPool, selectedLivePool, zeroForOne]);

  const reserveIn = selectedLivePool
    ? zeroForOne
      ? BigInt(selectedLivePool.kuna_reserve)
      : BigInt(selectedLivePool.token_reserve)
    : zeroForOne
      ? refPool.reserve0
      : refPool.reserve1;

  const reserveOut = selectedLivePool
    ? zeroForOne
      ? BigInt(selectedLivePool.token_reserve)
      : BigInt(selectedLivePool.kuna_reserve)
    : zeroForOne
      ? refPool.reserve1
      : refPool.reserve0;

  const feeBps = selectedLivePool ? selectedLivePool.fee_bps : refPool.feeBps;

  const amountInRaw = useMemo(() => {
    if (selectedLivePool) {
      return parseTokenAmount(amountInStr, tokenIn.decimals);
    }
    return parseTokenUnits(amountInStr, tokenIn.decimals);
  }, [amountInStr, selectedLivePool, tokenIn.decimals]);

  const quote = useMemo(() => {
    if (!amountInRaw || amountInRaw <= 0n) return null;
    if (selectedLivePool) {
      const amountOut = computeKvpPoolQuote(amountInRaw, reserveIn, reserveOut, feeBps);
      if (amountOut === null || amountOut <= 0n) return null;
      const clampedSlippage = Math.max(0, Math.min(5000, Math.round(slippageBps)));
      const minAmountOut = (amountOut * BigInt(10_000 - clampedSlippage)) / 10_000n;
      const feeAmount = (amountInRaw * BigInt(feeBps)) / 10_000n;
      const impactBps = computeKvpPriceImpactBps(amountInRaw, reserveIn, reserveOut, amountOut);
      return {
        amountOut,
        minAmountOut,
        feeAmount,
        priceImpactPct: impactBps !== null ? impactBps / 100 : 0,
      };
    }
    return computeSwapQuote(amountInRaw, reserveIn, reserveOut, slippageBps);
  }, [amountInRaw, feeBps, reserveIn, reserveOut, selectedLivePool, slippageBps]);

  const priceImpactAssessment = useMemo(
    () => (quote ? classifyPriceImpact(quote.priceImpactPct) : null),
    [quote],
  );

  const spotRateDisplay = useMemo(() => {
    if (reserveIn <= 0n || reserveOut <= 0n) return null;
    const inHuman = Number(reserveIn) / 10 ** tokenIn.decimals;
    const outHuman = Number(reserveOut) / 10 ** tokenOut.decimals;
    if (!Number.isFinite(inHuman) || inHuman <= 0 || !Number.isFinite(outHuman)) return null;
    return outHuman / inHuman;
  }, [reserveIn, reserveOut, tokenIn.decimals, tokenOut.decimals]);

  const poolRecentSwaps = useMemo(
    () => recentSwaps.filter((s) => s.poolId === selectedPoolId).slice(0, 5),
    [recentSwaps, selectedPoolId],
  );

  const interfaceFeeConfig = getSwapInterfaceFeeConfig();
  const interfaceFeeRaw = useMemo(
    () =>
      amountInRaw && amountInRaw > 0n
        ? computeSwapInterfaceFee(amountInRaw, interfaceFeeConfig.feeBps)
        : 0n,
    [amountInRaw, interfaceFeeConfig.feeBps],
  );

  const batchSteps = useMemo(() => {
    if (selectedLivePool || !amountInRaw || !quote) return [];
    return buildWaveASwapBatchPlan({
      poolId: refPool.id,
      tokenIn: zeroForOne ? refPool.token0 : refPool.token1,
      tokenOut: zeroForOne ? refPool.token1 : refPool.token0,
      amountIn: amountInRaw,
      minAmountOut: quote.minAmountOut,
    });
  }, [amountInRaw, quote, refPool, selectedLivePool, zeroForOne]);

  async function onConnectExtension() {
    try {
      const signer = await connectExtensionSigner();
      setExtSigner(signer);
      toast.success(`Connected ${shortId(signer.addressKvnc)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extension connection failed");
    }
  }

  const handleExecuteSwap = async () => {
    if (!amountInRaw || !quote) {
      toast.error("Enter a valid positive swap amount");
      return;
    }

    // Live on-chain KVP-102 pool execution via client-signed token_buy / token_sell
    if (selectedLivePool) {
      if (selectedLivePool.paused) {
        toast.error(`${selectedLivePool.symbol} pool is currently paused`);
        return;
      }
      if (!activeSigner) {
        toast.error("Unlock your Web Wallet on /wallet or connect window.kovanica to swap");
        return;
      }
      setSubmitting(true);
      setLastSwap(null);
      setSwapStatus(
        `Preparing ${zeroForOne ? "token_buy" : "token_sell"} on ${selectedLivePool.symbol} / KVNC…`,
      );
      try {
        const res = zeroForOne
          ? await executeTokenBuy(activeSigner, {
              contract: selectedLivePool.address,
              kunaInAtoms: amountInRaw,
              minOutAtoms: quote.minAmountOut,
              onStatus: setSwapStatus,
            })
          : await executeTokenSell(activeSigner, {
              contract: selectedLivePool.address,
              tokensInAtoms: amountInRaw,
              minOutAtoms: quote.minAmountOut,
              onStatus: setSwapStatus,
            });
        setLastSwap(res);
        setSwapStatus(null);
        setRecentSwaps((prev) => [
          {
            poolId: selectedPoolId,
            txHash: res.txHash,
            method: res.method,
            inLabel: `${formatTokenAmount(amountInRaw, tokenIn.decimals)} ${tokenIn.symbol}`,
            outLabel: `${formatTokenAmount(quote.amountOut, tokenOut.decimals)} ${tokenOut.symbol}`,
            timestamp: new Date().toLocaleTimeString(),
          },
          ...prev.slice(0, 19),
        ]);
        toast.success(`Swap broadcast! ${res.method} (${shortId(res.txHash)})`);
        void fetchLivePools();
      } catch (err) {
        setSwapStatus(null);
        toast.error(err instanceof Error ? err.message : "Swap execution failed");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Reference preview pool path (Wave A batch preview)
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
          `Preview quote ready: ${batchSteps.map((s) => s.method).join(" → ")} (min out ${formatTokenUnits(quote.minAmountOut, tokenOut.decimals)} ${tokenOut.symbol}). Initialize a live KVP-102 pool on /pools to execute on-chain.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Swap execution failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell>
      <main className="mx-auto w-full max-w-xl space-y-5 px-4 py-6 md:px-6 md:py-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/wallet" className="text-muted transition-colors hover:text-fg">
              <ArrowLeft className="size-5" />
            </Link>
            <div>
              <p className="font-mono text-[10px] tracking-wide text-emerald-400 uppercase">
                Native AMM / DEX · Constant Product ({(feeBps / 100).toFixed(2)}% LP Fee)
              </p>
              <h1 className="font-display text-2xl tracking-tight text-fg">Kovanica Swap</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchLivePools()}
              disabled={loadingPools}
              aria-label="Refresh on-chain pools"
            >
              <RefreshCw className={loadingPools ? "size-3.5 animate-spin" : "size-3.5"} />
            </Button>
            <Link to="/pools">
              <Button variant="outline" size="sm" className="text-xs">
                <Layers className="mr-1.5 size-3.5" />
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

        {/* Signer status bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface/60 px-3.5 py-2.5 text-xs">
          {activeSigner ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="size-2 shrink-0 rounded-full bg-emerald-400" />
              <span className="text-muted">
                Signer ({activeSigner.kind === "web-wallet" ? "Web Wallet" : "window.kovanica"}):
              </span>
              <code className="truncate font-mono text-fg">
                {shortId(activeSigner.addressKvnc)}
              </code>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted">
              <Wallet className="size-3.5 text-gold" />
              <span>Unlock Web Wallet or connect window.kovanica for live swaps.</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            {!activeSigner && hasExtension && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onConnectExtension()}
              >
                Connect Extension
              </Button>
            )}
            {!activeSigner && (
              <Button asChild size="sm" variant="outline">
                <Link to="/wallet">Unlock Wallet</Link>
              </Button>
            )}
          </div>
        </div>

        {/* Live Wave B Fee Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface/60 px-4 py-2.5 text-xs text-muted">
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
            On-chain Pools:{" "}
            <strong className="font-mono text-emerald-400">{livePools.length} live</strong>
          </span>
        </div>

        {showSettings && (
          <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-fg">
                Slippage Tolerance (<code>min_out</code> guard)
              </span>
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
        <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs text-muted">Active Liquidity Pool</label>
              {selectedLivePool ? (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400 uppercase">
                  Live Testnet Pool
                </span>
              ) : (
                <Link
                  to="/pools"
                  className="font-mono text-[10px] text-gold hover:underline"
                >
                  Preview Pool · Initialize live pool →
                </Link>
              )}
            </div>
            <select
              value={selectedPoolId}
              onChange={(e) => {
                setSelectedPoolId(e.target.value);
                setLastSwap(null);
              }}
              className="h-10 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
            >
              {livePools.length > 0 && (
                <optgroup label="Live On-Chain KVP-102 Pools (Testnet)">
                  {livePools.map((p) => (
                    <option key={p.address} value={`live:${p.address}`}>
                      KVNC / {p.symbol} —{" "}
                      {formatTokenAmount(BigInt(p.kuna_reserve), KVNC_DECIMALS)} KVNC +{" "}
                      {formatTokenAmount(BigInt(p.token_reserve), p.decimals)} {p.symbol} (
                      {(p.fee_bps / 100).toFixed(2)}%)
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Reference Preview Pools (Quote-Only)">
                {DEFAULT_DEX_POOLS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.token0.symbol} / {p.token1.symbol} — TVL ${p.tvlUsd.toLocaleString("en-US")}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Sell Input */}
          <div className="space-y-2 rounded-lg border border-border bg-bg p-4">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>You Pay</span>
              <span className="font-mono">
                Reserve:{" "}
                {selectedLivePool
                  ? formatTokenAmount(reserveIn, tokenIn.decimals)
                  : formatTokenUnits(reserveIn, tokenIn.decimals)}{" "}
                {tokenIn.symbol}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                value={amountInStr}
                onChange={(e) => setAmountInStr(e.target.value)}
                placeholder="0.0"
                disabled={submitting}
                className="flex-1 bg-transparent font-mono text-2xl text-fg focus:outline-none"
              />
              <span className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm font-medium text-fg">
                {(() => {
                  const iconSrc = resolveTokenIcon(
                    tokenIn.symbol,
                    selectedLivePool && !tokenIn.isNative ? selectedLivePool.icon : null,
                  );
                  return iconSrc ? (
                    <img src={iconSrc} alt="" className="size-5 rounded-full object-cover" />
                  ) : null;
                })()}
                {tokenIn.symbol}
              </span>
            </div>
          </div>

          <div className="-my-1 flex justify-center">
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
          <div className="space-y-2 rounded-lg border border-border bg-bg p-4">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>You Receive (Estimated)</span>
              <span className="font-mono">
                Reserve:{" "}
                {selectedLivePool
                  ? formatTokenAmount(reserveOut, tokenOut.decimals)
                  : formatTokenUnits(reserveOut, tokenOut.decimals)}{" "}
                {tokenOut.symbol}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 font-mono text-2xl text-fg">
                {quote
                  ? selectedLivePool
                    ? formatTokenAmount(quote.amountOut, tokenOut.decimals)
                    : formatTokenUnits(quote.amountOut, tokenOut.decimals, 6)
                  : "0.0"}
              </div>
              <span className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm font-medium text-fg">
                {(() => {
                  const iconSrc = resolveTokenIcon(
                    tokenOut.symbol,
                    selectedLivePool && !tokenOut.isNative ? selectedLivePool.icon : null,
                  );
                  return iconSrc ? (
                    <img src={iconSrc} alt="" className="size-5 rounded-full object-cover" />
                  ) : null;
                })()}
                {tokenOut.symbol}
              </span>
            </div>
          </div>

          {/* Quote Details */}
          {quote && (
            <div className="space-y-1.5 rounded-lg border border-border/70 bg-bg/60 p-3 text-xs">
              <div className="flex justify-between text-muted">
                <span>LP Fee ({(feeBps / 100).toFixed(2)}%)</span>
                <span className="font-mono text-fg">
                  {selectedLivePool
                    ? formatTokenAmount(quote.feeAmount, tokenIn.decimals)
                    : formatTokenUnits(quote.feeAmount, tokenIn.decimals, 6)}{" "}
                  {tokenIn.symbol}
                </span>
              </div>
              <div className="flex justify-between text-muted">
                <Link to="/support" className="hover:text-gold hover:underline">
                  Interface Fee ({(interfaceFeeConfig.feeBps / 100).toFixed(2)}%)
                </Link>
                <span className="font-mono text-fg">
                  {interfaceFeeConfig.active
                    ? `${formatTokenUnits(interfaceFeeRaw, tokenIn.decimals, 6)} ${tokenIn.symbol}`
                    : "0 (testnet)"}
                </span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Price Impact</span>
                <span
                  data-testid="swap-price-impact"
                  className={
                    priceImpactAssessment?.severity === "high"
                      ? "font-mono font-semibold text-red-400"
                      : priceImpactAssessment?.severity === "moderate"
                        ? "font-mono font-semibold text-amber-400"
                        : "font-mono text-emerald-400"
                  }
                >
                  {quote.priceImpactPct.toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Minimum Received ({(slippageBps / 100).toFixed(2)}% slippage)</span>
                <span className="font-mono font-semibold text-fg">
                  {selectedLivePool
                    ? formatTokenAmount(quote.minAmountOut, tokenOut.decimals)
                    : formatTokenUnits(quote.minAmountOut, tokenOut.decimals, 6)}{" "}
                  {tokenOut.symbol}
                </span>
              </div>

              {priceImpactAssessment?.warning && (
                <div
                  role="alert"
                  data-testid="swap-price-impact-warning"
                  className={
                    priceImpactAssessment.severity === "high"
                      ? "mt-2 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300"
                      : "mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300"
                  }
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{priceImpactAssessment.warning}</span>
                </div>
              )}
            </div>
          )}

          {/* Execution preview: Live KVP-102 Call OR Reference Wave A Batch */}
          {selectedLivePool && quote && (
            <div className="space-y-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-emerald-400">
                <Zap className="size-3.5" />
                <span>
                  On-Chain KVP-102 Call:{" "}
                  <code className="font-mono">{zeroForOne ? "token_buy" : "token_sell"}</code>
                </span>
              </div>
              <p className="font-mono text-[11px] text-muted">
                Contract {shortId(selectedLivePool.address)} · Call.value ={" "}
                {zeroForOne
                  ? `${formatTokenAmount(amountInRaw ?? 0n, KVNC_DECIMALS)} KVNC`
                  : "0 KVNC"}{" "}
                · min_out = {formatTokenAmount(quote.minAmountOut, tokenOut.decimals)}{" "}
                {tokenOut.symbol}
              </p>
            </div>
          )}

          {!selectedLivePool && batchSteps.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-purple-400">
                <Zap className="size-3.5" />
                <span>1-Tx Wave A Atomic Batch ({batchSteps.length} actions)</span>
              </div>
              <ol className="list-inside list-decimal space-y-1 font-mono text-xs text-muted">
                {batchSteps.map((step, i) => (
                  <li key={`${step.method}-${i}`}>
                    <span className="text-fg">{step.method}</span> — {step.description}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {swapStatus && (
            <div className="flex items-center gap-2 rounded-lg border border-blue/30 bg-blue/10 px-3.5 py-2.5 text-xs text-blue">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              <span>{swapStatus}</span>
            </div>
          )}

          <Button
            className="h-11 w-full"
            disabled={
              !quote ||
              submitting ||
              Boolean(selectedLivePool && (!activeSigner || selectedLivePool.paused))
            }
            onClick={() => void handleExecuteSwap()}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {selectedLivePool
                  ? `Signing ${zeroForOne ? "token_buy" : "token_sell"}…`
                  : "Signing Wave A Batch…"}
              </>
            ) : (
              <>
                <ShieldCheck className="mr-2 size-4" />
                {selectedLivePool
                  ? selectedLivePool.paused
                    ? `${selectedLivePool.symbol} Pool Paused`
                    : !activeSigner
                      ? "Unlock Wallet to Execute Swap"
                      : `Sign & Swap ${tokenIn.symbol} → ${tokenOut.symbol}`
                  : tokenIn.isNative
                    ? `Swap ${tokenIn.symbol} → ${tokenOut.symbol}`
                    : `Approve & Swap ${tokenIn.symbol} → ${tokenOut.symbol} (1-Tx Batch)`}
              </>
            )}
          </Button>

          {lastSwap && (
            <div className="space-y-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="size-5" />
                <h3 className="font-medium">Swap Broadcast to Testnet!</h3>
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                <div className="flex justify-between gap-2">
                  <span className="text-muted">Method</span>
                  <span className="text-fg">{lastSwap.method}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted">Tx Hash</span>
                  <span className="truncate text-fg">{shortId(lastSwap.txHash)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted">Network Fee</span>
                  <span className="text-fg">
                    {(Number(lastSwap.fee) / ATOM).toFixed(6)} {TOKEN}
                  </span>
                </div>
              </div>
              <Button asChild size="sm" className="w-full text-xs">
                <Link to="/explorer">
                  <ExternalLink className="mr-1.5 size-3.5" />
                  Open in Explorer
                </Link>
              </Button>
            </div>
          )}
        </div>

        {/* Selected Pair Pool Stats & Recent Swaps Strip */}
        <section className="space-y-3 rounded-xl border border-border bg-surface p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] tracking-wider text-subtle uppercase">
              Pool Stats · {tokenIn.symbol} / {tokenOut.symbol}
            </span>
            {selectedLivePool ? (
              <Link
                to="/explorer"
                search={{ tab: "contracts", contract: selectedLivePool.address } as Record<string, string>}
                className="font-mono text-[10px] text-blue hover:underline"
              >
                Inspect Pool Contract →
              </Link>
            ) : (
              <Link to="/pools" className="font-mono text-[10px] text-muted hover:text-fg hover:underline">
                Manage Liquidity →
              </Link>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 font-mono text-[11px]">
            <div className="rounded-lg border border-border/70 bg-bg px-3 py-2">
              <p className="text-[10px] text-subtle">Spot Rate</p>
              <p className="mt-0.5 truncate text-fg">
                {spotRateDisplay !== null
                  ? `1 ${tokenIn.symbol} ≈ ${spotRateDisplay.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${tokenOut.symbol}`
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-border/70 bg-bg px-3 py-2">
              <p className="text-[10px] text-subtle">LP Fee</p>
              <p className="mt-0.5 text-emerald-400">{(feeBps / 100).toFixed(2)}%</p>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-lg border border-border/70 bg-bg px-3 py-2">
              <p className="text-[10px] text-subtle">
                {selectedLivePool ? "LP Supply" : "Reference TVL"}
              </p>
              <p className="mt-0.5 truncate text-fg">
                {selectedLivePool
                  ? `${formatTokenAmount(BigInt(selectedLivePool.lp_total), 0)} LP`
                  : `$${refPool.tvlUsd.toLocaleString("en-US")}`}
              </p>
            </div>
          </div>

          <div className="border-t border-border/60 pt-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-subtle">
                <Clock className="size-3" />
                Recent Swaps ({poolRecentSwaps.length})
              </span>
              <span className="font-mono text-[10px] text-muted">
                {selectedLivePool ? "Live session executions" : "Preview mode"}
              </span>
            </div>
            {poolRecentSwaps.length === 0 ? (
              <p className="text-[11px] text-muted">
                No swaps broadcast for {tokenIn.symbol}/{tokenOut.symbol} in this session yet.
              </p>
            ) : (
              <ul className="space-y-1 font-mono text-[11px]">
                {poolRecentSwaps.map((sw) => (
                  <li
                    key={sw.txHash}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/50 bg-bg px-2.5 py-1.5"
                  >
                    <span className="text-fg">
                      {sw.inLabel} → <strong className="text-emerald-400">{sw.outLabel}</strong>
                    </span>
                    <span className="text-subtle">
                      {shortId(sw.txHash, 6)} · {sw.timestamp}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </Shell>
  );
}
