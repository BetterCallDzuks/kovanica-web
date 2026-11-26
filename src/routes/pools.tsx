import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  Rocket,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Shell } from "@/components/layout/shell";
import { PoolView } from "@/components/protocol/pool-view";
import { api, useApiSource } from "@/lib/api/client";
import { shortId } from "@/lib/ledger/hash";
import { useLedger } from "@/lib/ledger/store";
import { ATOM, FIXED_FEES, TOKEN } from "@/lib/networkConstants";
import {
  DEFAULT_DEX_POOLS,
  buildWaveAAddLiquidityBatchPlan,
  computeLpPosition,
  computeRemoveLiquidityShares,
  estimatePoolAprPct,
  formatTokenUnits,
  parseTokenUnits,
} from "@/lib/amm/math";
import { parseTokenAmount, type ApiToken } from "@/lib/tokens/codec";
import { parseAddr } from "@/lib/wallet/address";
import {
  connectExtensionSigner,
  getKovanicaExtension,
  getWatchedTokenContracts,
  initTokenPool,
  watchTokenContract,
  webWalletSigner,
  type ActiveSigner,
  type AmmCallResult,
} from "@/lib/wallet/tx-builder";
import { toast } from "sonner";

export const Route = createFileRoute("/pools")({
  component: PoolsPage,
});

const KVNC_DECIMALS = 9;

function PoolsPage() {
  const source = useApiSource();
  const wallet = useLedger((s) => s.wallet);

  const [selectedPoolId, setSelectedPoolId] = useState(DEFAULT_DEX_POOLS[0]!.id);
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount0Str, setAmount0Str] = useState("1000");
  const [amount1Str, setAmount1Str] = useState("500");
  const [lpRemoveStr, setLpRemoveStr] = useState("100000");

  // Live KVP-102 token_init_pool state
  const [availableTokens, setAvailableTokens] = useState<ApiToken[]>([]);
  const [initContract, setInitContract] = useState("");
  const [initKvncStr, setInitKvncStr] = useState("10");
  const [initTokensStr, setInitTokensStr] = useState("1000");
  const [initFeeBpsStr, setInitFeeBpsStr] = useState("30");
  const [initDecimals, setInitDecimals] = useState(9);
  const [extSigner, setExtSigner] = useState<ActiveSigner | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [initStatus, setInitStatus] = useState<string | null>(null);
  const [initResult, setInitResult] = useState<AmmCallResult | null>(null);
  const [poolRefreshKey, setPoolRefreshKey] = useState(0);

  // Live Wave B base fee & storage deposit
  const [baseFeeAtoms, setBaseFeeAtoms] = useState<number>(1);
  const [depositPerByteAtoms, setDepositPerByteAtoms] = useState<number>(100_000);

  const unlockedSigner = useMemo(() => webWalletSigner(wallet), [wallet]);
  const activeSigner = unlockedSigner ?? extSigner;
  const hasExtension = useMemo(() => getKovanicaExtension() !== null, []);

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

  // Load discovered + watched KVP-102 tokens for the Initialize Pool picker
  useEffect(() => {
    if (source === "mainnet") {
      setAvailableTokens([]);
      return;
    }
    let active = true;
    const watched = getWatchedTokenContracts();
    const qs = new URLSearchParams();
    if (activeSigner?.addressHex) qs.set("address", activeSigner.addressHex);
    if (watched.length) qs.set("watched", watched.join(","));
    const query = qs.toString();
    api<ApiToken[]>(`/api/tokens${query ? `?${query}` : ""}`)
      .then((rows) => {
        if (!active || !Array.isArray(rows)) return;
        setAvailableTokens(rows);
        if (rows.length > 0 && !initContract) {
          setInitContract(rows[0]!.address);
          setInitDecimals(rows[0]!.decimals);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [activeSigner?.addressHex, source]);

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

  async function onConnectExtension() {
    try {
      const signer = await connectExtensionSigner();
      setExtSigner(signer);
      toast.success(`Connected ${shortId(signer.addressKvnc)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extension connection failed");
    }
  }

  async function handleInitKvpPool() {
    if (!activeSigner) {
      toast.error("Unlock your Web Wallet on /wallet or connect window.kovanica first");
      return;
    }
    const contractHex = parseAddr(initContract.trim());
    if (!contractHex) {
      toast.error("Enter a valid KVP-102 token contract address (kvnc…dag or 64-hex)");
      return;
    }
    const kunaInAtoms = parseTokenAmount(initKvncStr, KVNC_DECIMALS);
    if (!kunaInAtoms) {
      toast.error("Enter a valid positive initial KVNC reserve");
      return;
    }
    const tokensInAtoms = parseTokenAmount(initTokensStr, initDecimals);
    if (!tokensInAtoms) {
      toast.error("Enter a valid positive initial token reserve");
      return;
    }
    const feeBps = Number.parseInt(initFeeBpsStr.trim(), 10);
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1_000) {
      toast.error("Fee must be an integer between 0 and 1000 bps (max 10%)");
      return;
    }

    setInitializing(true);
    setInitResult(null);
    setInitStatus("Preparing token_init_pool call…");
    try {
      const res = await initTokenPool(activeSigner, {
        contract: contractHex,
        kunaInAtoms,
        tokensInAtoms,
        feeBps,
        onStatus: setInitStatus,
      });
      watchTokenContract(res.contractHex);
      setInitResult(res);
      setInitStatus(null);
      setPoolRefreshKey((k) => k + 1);
      toast.success(`Pool initialized (${shortId(res.txHash)})!`);
    } catch (e) {
      setInitStatus(null);
      toast.error(e instanceof Error ? e.message : "Pool initialization failed");
    } finally {
      setInitializing(false);
    }
  }

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

  const lpRemoveRaw = useMemo(() => {
    const clean = lpRemoveStr.trim();
    if (!clean || !/^\d+$/.test(clean)) return 0n;
    try {
      return BigInt(clean);
    } catch {
      return 0n;
    }
  }, [lpRemoveStr]);

  // Preview 1% reference LP position when a wallet is active on the Wave A simulator
  const refUserLpShares = useMemo(
    () => (activeSigner ? selectedPool.totalLpSupply / 100n : 0n),
    [activeSigner, selectedPool.totalLpSupply],
  );
  const refRemoveEstimate = useMemo(
    () =>
      computeLpPosition({
        userLpShares: lpRemoveRaw,
        totalLpSupply: selectedPool.totalLpSupply,
        reserve0: selectedPool.reserve0,
        reserve1: selectedPool.reserve1,
      }),
    [lpRemoveRaw, selectedPool],
  );

  const handleRemoveLiquidity = async () => {
    if (lpRemoveRaw <= 0n) {
      toast.error("Enter a valid positive integer LP share amount");
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
          actions: [
            {
              contract: selectedPool.id,
              method: "amm_remove_liquidity",
              description: `Burn ${lpRemoveRaw.toString()} LP shares on ${selectedPool.token0.symbol}/${selectedPool.token1.symbol}`,
              valueAtoms: "0",
            },
          ],
          feeAtoms: String(baseFeeAtoms * 300 + FIXED_FEES.rwa_mint),
        });
        toast.success(
          `Signed amm_remove_liquidity (${lpRemoveRaw.toString()} LP shares) on ${selectedPool.token0.symbol}/${selectedPool.token1.symbol}`,
        );
      } else {
        toast.success(
          `Prepared amm_remove_liquidity (${lpRemoveRaw.toString()} LP → ~${formatTokenUnits(refRemoveEstimate.underlying0, selectedPool.token0.decimals)} ${selectedPool.token0.symbol} + ${formatTokenUnits(refRemoveEstimate.underlying1, selectedPool.token1.decimals)} ${selectedPool.token1.symbol})`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove liquidity failed");
    }
  };

  return (
    <Shell>
      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 md:px-6 md:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/wallet" className="text-muted transition-colors hover:text-fg">
              <ArrowLeft className="size-5" />
            </Link>
            <div>
              <p className="font-mono text-[10px] tracking-wide text-emerald-400 uppercase">
                Native AMM Liquidity · x · y = k
              </p>
              <h1 className="font-display text-2xl tracking-tight text-fg">AMM Liquidity Pools</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/pool"
              className="font-mono text-[11px] text-muted hover:text-fg hover:underline"
            >
              Mining Pool (Stratum) →
            </Link>
            <Link to="/swap">
              <Button size="sm" className="text-xs">
                <ArrowLeftRight className="mr-1.5 size-3.5" />
                Open Swap
              </Button>
            </Link>
          </div>
        </div>

        {/* Live Wave B Fee Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface/60 px-4 py-2.5 text-xs text-muted">
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

        {/* Initialize KVP-102 On-Chain Pool (token_init_pool) */}
        <section className="space-y-4 rounded-xl border border-border bg-surface p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] tracking-wide text-blue uppercase">
                Live Testnet Execution · token_init_pool
              </p>
              <h2 className="mt-0.5 font-medium text-fg">
                Initialize KVP-102 Liquidity Pool (KVNC / Token)
              </h2>
              <p className="mt-1 text-xs text-muted">
                Seed a constant-product pool on any KVP-102 token contract you own or mint. Sends{" "}
                <code className="text-fg">kuna_in</code> as <code className="text-fg">Call.value</code>{" "}
                and locks <code className="text-fg">tokens_in</code> from your balance.
              </p>
            </div>
            <Link
              to="/multi-asset"
              className="font-mono text-[11px] text-blue hover:underline"
            >
              Create KVP-102 Token →
            </Link>
          </div>

          {/* Signer status bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3.5 py-2.5 text-xs">
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
                <span>Unlock your Web Wallet or connect window.kovanica to initialize a pool.</span>
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

          {availableTokens.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-muted">
                Select Discovered / Watched KVP-102 Token
              </label>
              <select
                value={
                  availableTokens.some((t) => t.address === initContract) ? initContract : ""
                }
                onChange={(e) => {
                  const chosen = availableTokens.find((t) => t.address === e.target.value);
                  if (chosen) {
                    setInitContract(chosen.address);
                    setInitDecimals(chosen.decimals);
                  }
                }}
                disabled={initializing}
                className="h-10 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              >
                <option value="">Custom contract address below…</option>
                {availableTokens.map((t) => (
                  <option key={t.address} value={t.address}>
                    {t.symbol} ({t.name}) — {shortId(t.address)} ({t.decimals} dec)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-muted">
                Token Contract Address (<code>kvnc…dag</code> or 64-hex)
              </label>
              <input
                value={initContract}
                onChange={(e) => setInitContract(e.target.value)}
                placeholder="kvnc…dag or 0x…"
                disabled={initializing}
                className="h-10 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Initial KVNC Reserve</label>
              <input
                value={initKvncStr}
                onChange={(e) => setInitKvncStr(e.target.value)}
                inputMode="decimal"
                disabled={initializing}
                className="h-10 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">
                Initial Token Reserve ({initDecimals} decimals)
              </label>
              <input
                value={initTokensStr}
                onChange={(e) => setInitTokensStr(e.target.value)}
                inputMode="decimal"
                disabled={initializing}
                className="h-10 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">
                Swap Fee (bps, 30 = 0.30%, max 1000)
              </label>
              <input
                value={initFeeBpsStr}
                onChange={(e) => setInitFeeBpsStr(e.target.value)}
                inputMode="numeric"
                disabled={initializing}
                className="h-10 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Token Decimals (0–18)</label>
              <input
                value={String(initDecimals)}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isInteger(n) && n >= 0 && n <= 18) setInitDecimals(n);
                }}
                inputMode="numeric"
                disabled={initializing}
                className="h-10 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
          </div>

          {initStatus && (
            <div className="flex items-center gap-2 rounded-lg border border-blue/30 bg-blue/10 px-3.5 py-2.5 text-xs text-blue">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              <span>{initStatus}</span>
            </div>
          )}

          <Button
            type="button"
            className="h-11 w-full"
            disabled={initializing || !activeSigner}
            onClick={() => void handleInitKvpPool()}
          >
            {initializing ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Signing &amp; Initializing Pool…
              </>
            ) : (
              <>
                <Rocket className="mr-2 size-4" />
                Sign &amp; Initialize Pool (token_init_pool)
              </>
            )}
          </Button>

          {initResult && (
            <div className="space-y-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="size-5" />
                <h3 className="font-medium">Pool Initialization Broadcast!</h3>
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                <div className="flex justify-between gap-2">
                  <span className="text-muted">Contract</span>
                  <span className="truncate text-fg">{initResult.contractKvnc}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted">Tx Hash</span>
                  <span className="truncate text-fg">{shortId(initResult.txHash)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted">Network Fee</span>
                  <span className="text-fg">
                    {(Number(initResult.fee) / ATOM).toFixed(6)} {TOKEN}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline" className="text-xs">
                  <Link to="/swap">
                    <ArrowLeftRight className="mr-1.5 size-3.5" />
                    Trade on Swap
                  </Link>
                </Button>
                <Button asChild size="sm" className="text-xs">
                  <Link to="/explorer">
                    <ExternalLink className="mr-1.5 size-3.5" />
                    View in Explorer
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* On-chain KVP-102 Pool Explorer + Live Swap Execution */}
        <section aria-label="On-chain KVP-102 pool quotes" className="border-t border-border pt-6">
          <PoolView refreshKey={poolRefreshKey} />
        </section>

        {/* Reference Pool Reserves & APR Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-bg/60 font-mono text-[10px] text-muted uppercase">
                <tr>
                  <th className="px-4 py-3">Pair (Reference)</th>
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
                      className={active ? "bg-purple-500/10" : "transition-colors hover:bg-bg/40"}
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
                          className="h-7 text-xs"
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

        {/* Add / Remove Liquidity Panel (Wave A Preview) */}
        <div className="space-y-4 rounded-xl border border-border bg-surface p-6">
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
                <Plus className="mr-1 size-3.5" />
                Add Liquidity
              </Button>
              <Button
                size="sm"
                variant={mode === "remove" ? "default" : "outline"}
                onClick={() => setMode("remove")}
                className="text-xs"
              >
                <Minus className="mr-1 size-3.5" />
                Remove Liquidity
              </Button>
            </div>
          </div>

          {mode === "add" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted">
                    {selectedPool.token0.symbol} Deposit Amount
                  </label>
                  <input
                    value={amount0Str}
                    onChange={(e) => setAmount0Str(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">
                    {selectedPool.token1.symbol} Deposit Amount
                  </label>
                  <input
                    value={amount1Str}
                    onChange={(e) => setAmount1Str(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
                  />
                </div>
              </div>

              {addBatchSteps.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-purple-400">
                    <Zap className="size-3.5" />
                    <span>1-Tx Wave A Atomic Batch ({addBatchSteps.length} actions)</span>
                  </div>
                  <ol className="list-inside list-decimal space-y-1 font-mono text-xs text-muted">
                    {addBatchSteps.map((step, i) => (
                      <li key={`${step.method}-${i}`}>
                        <span className="text-fg">{step.method}</span> — {step.description}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <Button className="w-full" onClick={() => void handleAddLiquidity()}>
                Approve &amp; Add Liquidity (1-Tx Wave A Batch)
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs text-muted">
                    LP Shares to Burn (raw units)
                  </label>
                  <div className="flex items-center gap-1">
                    {[25, 50, 75, 100].map((pct) => {
                      const base = refUserLpShares > 0n ? refUserLpShares : selectedPool.totalLpSupply / 100n;
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() =>
                            setLpRemoveStr(computeRemoveLiquidityShares(base, pct).toString())
                          }
                          className="rounded border border-border bg-bg px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-gold/40 hover:text-fg"
                        >
                          {pct}%
                        </button>
                      );
                    })}
                  </div>
                </div>
                <input
                  value={lpRemoveStr}
                  onChange={(e) => setLpRemoveStr(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
                />
              </div>

              <div className="space-y-1 rounded-lg border border-border bg-bg p-3 font-mono text-xs">
                <div className="flex justify-between text-muted">
                  <span>Pool Share Burned</span>
                  <span className="text-emerald-400">{refRemoveEstimate.sharePct.toFixed(4)}%</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Est. {selectedPool.token0.symbol} Received</span>
                  <span className="text-fg">
                    {formatTokenUnits(refRemoveEstimate.underlying0, selectedPool.token0.decimals)}{" "}
                    {selectedPool.token0.symbol}
                  </span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Est. {selectedPool.token1.symbol} Received</span>
                  <span className="text-fg">
                    {formatTokenUnits(refRemoveEstimate.underlying1, selectedPool.token1.decimals)}{" "}
                    {selectedPool.token1.symbol}
                  </span>
                </div>
              </div>

              <Button className="w-full" variant="outline" onClick={() => void handleRemoveLiquidity()}>
                Burn LP &amp; Withdraw Reserves
              </Button>
            </div>
          )}
        </div>
      </main>
    </Shell>
  );
}
