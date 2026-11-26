/**
 * KVP-102 AMM pools — live on-chain pool explorer, exact quote calculator,
 * and client-signed swap execution (`token_buy` / `token_sell`).
 *
 * A pool is contract state: `/api/pools` scans token contracts (plus any locally
 * watched token contracts) and decodes each `kvnc/v1/pool` slot. Swapping signs
 * a canonical `Call` transaction (`token_buy` with `Call.value = kuna_in` or
 * `token_sell` with `Call.value = 0`) via the unlocked Web Wallet or `window.kovanica`
 * and broadcasts through `/api/submit_tx` (`kovanica_sendRawTransaction`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownUp,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  Minus,
  RefreshCw,
  ShieldCheck,
  Wallet,
  Waves,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, useApiSource } from "@/lib/api/client";
import { useLedger } from "@/lib/ledger/store";
import { shortId } from "@/lib/ledger/hash";
import { ATOM, TOKEN } from "@/lib/networkConstants";
import {
  computeLpPosition,
  computeRemoveLiquidityShares,
} from "@/lib/amm/math";
import { formatTokenAmount, parseTokenAmount } from "@/lib/tokens/codec";
import { KVNC_COIN_ICON, resolveTokenIcon } from "@/lib/tokens/icons";
import { priceImpactBps, quote, type ApiPool } from "@/lib/tokens/pool";
import {
  connectExtensionSigner,
  executeRemoveLiquidity,
  executeTokenBuy,
  executeTokenSell,
  getKovanicaExtension,
  getWatchedTokenContracts,
  webWalletSigner,
  type ActiveSigner,
  type AmmCallResult,
} from "@/lib/wallet/tx-builder";

/** Native KVNC always has 9 decimals. */
const KVNC_DECIMALS = 9;

const SLIPPAGE_PRESETS = [
  { label: "0.5%", bps: 50 },
  { label: "1.0%", bps: 100 },
  { label: "2.0%", bps: 200 },
] as const;

export function PoolView({ refreshKey = 0 }: { refreshKey?: number }) {
  const source = useApiSource();
  const wallet = useLedger((s) => s.wallet);
  const [pools, setPools] = useState<ApiPool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"swap" | "remove">("swap");
  const [dir, setDir] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("1");
  const [lpRemoveStr, setLpRemoveStr] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(50);
  const [loading, setLoading] = useState(false);

  const [extSigner, setExtSigner] = useState<ActiveSigner | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [swapStatus, setSwapStatus] = useState<string | null>(null);
  const [lastSwap, setLastSwap] = useState<AmmCallResult | null>(null);

  const unlockedSigner = useMemo(() => webWalletSigner(wallet), [wallet]);
  const activeSigner = unlockedSigner ?? extSigner;
  const activeAddressHex = activeSigner?.addressHex ?? wallet?.address ?? null;
  const hasExtension = useMemo(() => getKovanicaExtension() !== null, []);

  const genRef = useRef(0);
  const inFlightGenRef = useRef<number | null>(null);
  const currentSourceRef = useRef(source);
  currentSourceRef.current = source;

  async function load() {
    const reqSource = currentSourceRef.current;
    if (reqSource === "mainnet") {
      setPools([]);
      setSelected(null);
      setError(null);
      setLoading(false);
      return;
    }
    const myGen = genRef.current;
    if (inFlightGenRef.current === myGen) return;
    inFlightGenRef.current = myGen;
    setLoading(true);
    setError(null);
    try {
      const watched = getWatchedTokenContracts();
      const qs = new URLSearchParams();
      if (watched.length) qs.set("watched", watched.join(","));
      if (activeAddressHex) qs.set("address", activeAddressHex);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const rows = await api<ApiPool[]>(`/api/pools${suffix}`);
      if (!Array.isArray(rows)) {
        throw new Error("Malformed pools response");
      }
      if (myGen === genRef.current && reqSource === currentSourceRef.current) {
        setPools(rows);
        setSelected((current) =>
          current && rows.some((r) => r.address === current) ? current : (rows[0]?.address ?? null),
        );
      }
    } catch (e) {
      if (myGen === genRef.current && reqSource === currentSourceRef.current) {
        setPools([]);
        setError(e instanceof Error ? e.message : "Failed to load pools");
      }
    } finally {
      if (inFlightGenRef.current === myGen) {
        inFlightGenRef.current = null;
      }
      if (myGen === genRef.current && reqSource === currentSourceRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    genRef.current += 1;
    inFlightGenRef.current = null;
    setPools(source === "mainnet" ? [] : null);
    setSelected(null);
    setError(null);
    setLoading(false);
    if (source === "mainnet") return;
    void load();
    return () => {
      genRef.current += 1;
      inFlightGenRef.current = null;
    };
  }, [source, refreshKey, activeAddressHex]);

  const pool = useMemo(
    () => pools?.find((p) => p.address === selected) ?? pools?.[0] ?? null,
    [pools, selected],
  );

  const kunaReserve = pool ? BigInt(pool.kuna_reserve) : 0n;
  const tokenReserve = pool ? BigInt(pool.token_reserve) : 0n;
  const lpTotal = pool ? BigInt(pool.lp_total) : 0n;
  const userLpShares = pool?.lp_balance ? BigInt(pool.lp_balance) : 0n;
  const userLpPosition = useMemo(
    () =>
      computeLpPosition({
        userLpShares,
        totalLpSupply: lpTotal,
        reserve0: kunaReserve,
        reserve1: tokenReserve,
      }),
    [userLpShares, lpTotal, kunaReserve, tokenReserve],
  );
  const removeLpShares = useMemo(() => {
    const clean = lpRemoveStr.trim();
    if (!clean || !/^\d+$/.test(clean)) return 0n;
    try {
      return BigInt(clean);
    } catch {
      return 0n;
    }
  }, [lpRemoveStr]);
  const removeEstimate = useMemo(
    () =>
      computeLpPosition({
        userLpShares: removeLpShares,
        totalLpSupply: lpTotal,
        reserve0: kunaReserve,
        reserve1: tokenReserve,
      }),
    [removeLpShares, lpTotal, kunaReserve, tokenReserve],
  );
  const removeMinKuna = (removeEstimate.underlying0 * BigInt(10_000 - slippageBps)) / 10_000n;
  const removeMinTokens = (removeEstimate.underlying1 * BigInt(10_000 - slippageBps)) / 10_000n;
  const inDecimals = dir === "buy" ? KVNC_DECIMALS : (pool?.decimals ?? 0);
  const outDecimals = dir === "buy" ? (pool?.decimals ?? 0) : KVNC_DECIMALS;
  const atoms = pool ? parseTokenAmount(amount, inDecimals) : null;
  const out =
    pool && atoms !== null
      ? dir === "buy"
        ? quote(atoms, kunaReserve, tokenReserve, pool.fee_bps)
        : quote(atoms, tokenReserve, kunaReserve, pool.fee_bps)
      : null;
  const minOut = out !== null ? (out * BigInt(10_000 - slippageBps)) / 10_000n : null;
  const impact =
    pool && atoms !== null && out !== null && out > 0n
      ? priceImpactBps(
          atoms,
          dir === "buy" ? kunaReserve : tokenReserve,
          dir === "buy" ? tokenReserve : kunaReserve,
          out,
        )
      : null;

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Contract address copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  async function onConnectExtension() {
    try {
      const signer = await connectExtensionSigner();
      setExtSigner(signer);
      toast.success(`Connected ${shortId(signer.addressKvnc)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extension connection failed");
    }
  }

  async function onExecuteSwap() {
    if (!pool) return;
    if (pool.paused) {
      toast.error(`${pool.symbol} pool is currently paused`);
      return;
    }
    if (!activeSigner) {
      toast.error("Unlock your Web Wallet on /wallet or connect window.kovanica first");
      return;
    }
    if (atoms === null || out === null || minOut === null || out <= 0n) {
      toast.error("Enter a valid positive swap amount");
      return;
    }

    setSwapping(true);
    setLastSwap(null);
    setSwapStatus(`Preparing ${dir === "buy" ? "token_buy" : "token_sell"} transaction…`);
    try {
      const res =
        dir === "buy"
          ? await executeTokenBuy(activeSigner, {
              contract: pool.address,
              kunaInAtoms: atoms,
              minOutAtoms: minOut,
              onStatus: setSwapStatus,
            })
          : await executeTokenSell(activeSigner, {
              contract: pool.address,
              tokensInAtoms: atoms,
              minOutAtoms: minOut,
              onStatus: setSwapStatus,
            });
      setLastSwap(res);
      setSwapStatus(null);
      toast.success(
        `${res.method} broadcast (${shortId(res.txHash)}) on ${pool.symbol} / KVNC`,
      );
      void load();
    } catch (e) {
      setSwapStatus(null);
      toast.error(e instanceof Error ? e.message : "Swap failed");
    } finally {
      setSwapping(false);
    }
  }

  async function onExecuteRemoveLiquidity() {
    if (!pool) return;
    if (pool.paused) {
      toast.error(`${pool.symbol} pool is currently paused`);
      return;
    }
    if (!activeSigner) {
      toast.error("Unlock your Web Wallet on /wallet or connect window.kovanica first");
      return;
    }
    if (removeLpShares <= 0n) {
      toast.error("Enter a positive LP share amount to remove");
      return;
    }
    if (userLpShares > 0n && removeLpShares > userLpShares) {
      toast.error("Amount exceeds your LP share balance");
      return;
    }

    setSwapping(true);
    setLastSwap(null);
    setSwapStatus("Preparing amm_remove_liquidity transaction…");
    try {
      const res = await executeRemoveLiquidity(activeSigner, {
        contract: pool.address,
        lpShares: removeLpShares,
        minKunaOut: removeMinKuna,
        minTokensOut: removeMinTokens,
        onStatus: setSwapStatus,
      });
      setLastSwap(res);
      setSwapStatus(null);
      setLpRemoveStr("");
      toast.success(`amm_remove_liquidity broadcast (${shortId(res.txHash)}) on ${pool.symbol} / KVNC`);
      void load();
    } catch (e) {
      setSwapStatus(null);
      toast.error(e instanceof Error ? e.message : "Remove liquidity failed");
    } finally {
      setSwapping(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-brand text-blue uppercase">
            KVP-102 · RFC-002
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-tight text-fg italic md:text-4xl">
            Liquidity pools
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Every token contract can hold a constant-product pool between its own token and
            KVNC. Reserves, fee and LP supply are read straight from contract storage, and swaps
            sign <code className="font-mono text-xs text-fg">token_buy</code> /{" "}
            <code className="font-mono text-xs text-fg">token_sell</code> client-side.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} /> Refresh
        </Button>
      </header>

      {error && (
        <p className="rounded-xl border border-red/30 bg-red/5 p-3 text-sm text-red">{error}</p>
      )}

      {pools !== null && pools.length === 0 && !error && (
        <div className="rounded-xl border border-border bg-surface p-6">
          <div className="flex items-center gap-2 text-gold">
            <Waves className="size-4" />
            <p className="text-sm font-medium">No pools initialized yet</p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            A token becomes a pool only after its owner or minter calls{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">
              token_init_pool
            </code>{" "}
            on the token contract with an initial KVNC reserve, token reserve and fee (max 10%).
            Use the Initialize Pool panel above to seed a pool directly from your browser.
          </p>
        </div>
      )}

      {pools !== null && pools.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-3">
            {pools.map((row) => {
              const on = pool?.address === row.address;
              return (
                <button
                  key={row.address}
                  type="button"
                  onClick={() => {
                    setSelected(row.address);
                    setLastSwap(null);
                  }}
                  className={
                    on
                      ? "rounded-xl border border-gold/50 bg-gold/5 p-4 text-left"
                      : "rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-border hover:bg-surface-2"
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex shrink-0 -space-x-2">
                        {(() => {
                          const iconSrc = resolveTokenIcon(row.symbol, row.icon);
                          return iconSrc ? (
                            <img
                              src={iconSrc}
                              alt=""
                              className="size-7 rounded-full border border-border bg-bg object-cover"
                            />
                          ) : (
                            <span className="flex size-7 items-center justify-center rounded-full border border-border bg-surface-2">
                              <Waves className="size-4 text-blue" />
                            </span>
                          );
                        })()}
                        <img
                          src={KVNC_COIN_ICON}
                          alt="KVNC"
                          className="size-7 rounded-full border border-border bg-bg object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-display text-lg tracking-tight text-fg">
                          {row.symbol} / KVNC
                        </p>
                        <p className="truncate font-mono text-[11px] text-subtle">{row.name}</p>
                      </div>
                    </div>
                    {row.paused && (
                      <span className="rounded-full border border-red/40 bg-red/10 px-2 py-0.5 font-mono text-[10px] text-red uppercase">
                        Paused
                      </span>
                    )}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px]">
                    <dt className="text-subtle">KVNC reserve</dt>
                    <dd className="text-right text-fg">
                      {formatTokenAmount(BigInt(row.kuna_reserve), KVNC_DECIMALS)}
                    </dd>
                    <dt className="text-subtle">{row.symbol} reserve</dt>
                    <dd className="text-right text-fg">
                      {formatTokenAmount(BigInt(row.token_reserve), row.decimals)}
                    </dd>
                    <dt className="text-subtle">Fee</dt>
                    <dd className="text-right text-fg">{(row.fee_bps / 100).toFixed(2)}%</dd>
                    <dt className="text-subtle">Spot price</dt>
                    <dd className="text-right text-gold">
                      {row.price_kuna === null
                        ? "—"
                        : `${row.price_kuna.toLocaleString(undefined, {
                            maximumFractionDigits: 9,
                          })} KVNC`}
                    </dd>
                  </dl>

                  {activeAddressHex && (() => {
                    const rowPos = computeLpPosition({
                      userLpShares: BigInt(row.lp_balance ?? "0"),
                      totalLpSupply: BigInt(row.lp_total),
                      reserve0: BigInt(row.kuna_reserve),
                      reserve1: BigInt(row.token_reserve),
                    });
                    return (
                      <div className="mt-3 rounded-lg border border-border/70 bg-bg/70 px-3 py-2 font-mono text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-subtle">Your LP Position</span>
                          <span className={rowPos.lpShares > 0n ? "font-semibold text-emerald-400" : "text-muted"}>
                            {formatTokenAmount(rowPos.lpShares, 0)} LP ({rowPos.sharePct.toFixed(2)}%)
                          </span>
                        </div>
                        {rowPos.lpShares > 0n && (
                          <p className="mt-1 text-[10px] text-muted">
                            Est. underlying:{" "}
                            <span className="text-fg">
                              {formatTokenAmount(rowPos.underlying0, KVNC_DECIMALS)} KVNC
                            </span>{" "}
                            +{" "}
                            <span className="text-fg">
                              {formatTokenAmount(rowPos.underlying1, row.decimals)} {row.symbol}
                            </span>
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </button>
              );
            })}
          </div>

          {pool && (
            <div className="flex min-w-0 flex-col gap-4 self-start rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex rounded-md border border-border bg-bg p-0.5">
                  <button
                    type="button"
                    onClick={() => setPanelTab("swap")}
                    className={
                      panelTab === "swap"
                        ? "rounded px-2.5 py-1 text-[11px] font-medium text-fg bg-surface-2"
                        : "rounded px-2.5 py-1 text-[11px] font-medium text-muted hover:text-fg"
                    }
                  >
                    Quote &amp; Swap
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelTab("remove")}
                    className={
                      panelTab === "remove"
                        ? "rounded px-2.5 py-1 text-[11px] font-medium text-fg bg-surface-2"
                        : "rounded px-2.5 py-1 text-[11px] font-medium text-muted hover:text-fg"
                    }
                  >
                    Remove LP
                  </button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Copy contract address"
                  onClick={() => void copyAddress(pool.address)}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>

              {panelTab === "swap" ? (
                <>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={dir === "buy" ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setDir("buy")}
                    >
                      KVNC → {pool.symbol}
                    </Button>
                    <Button
                      type="button"
                      variant={dir === "sell" ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setDir("sell")}
                    >
                      {pool.symbol} → KVNC
                    </Button>
                  </div>

                  <label className="text-xs text-muted">
                    You pay ({dir === "buy" ? "KVNC" : pool.symbol})
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                      disabled={swapping}
                      className="mt-1 h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                      placeholder="0"
                    />
                  </label>

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted">Slippage</span>
                    <div className="flex gap-1">
                      {SLIPPAGE_PRESETS.map((p) => (
                        <button
                          key={p.bps}
                          type="button"
                          onClick={() => setSlippageBps(p.bps)}
                          className={
                            slippageBps === p.bps
                              ? "rounded bg-gold/20 px-2 py-0.5 font-mono text-[11px] text-gold"
                              : "rounded border border-border bg-bg px-2 py-0.5 font-mono text-[11px] text-muted hover:text-fg"
                          }
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-bg p-3">
                    <p className="text-[10px] uppercase tracking-wide text-subtle">You receive</p>
                    <p className="mt-1 break-all font-mono text-sm text-fg">
                      {out === null
                        ? "—"
                        : `${formatTokenAmount(out, outDecimals)} ${
                            dir === "buy" ? pool.symbol : "KVNC"
                          }`}
                    </p>
                    {minOut !== null && (
                      <p className="mt-1 font-mono text-[10px] text-muted">
                        Min received ({(slippageBps / 100).toFixed(1)}%):{" "}
                        {formatTokenAmount(minOut, outDecimals)}{" "}
                        {dir === "buy" ? pool.symbol : "KVNC"}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[10px] text-subtle">
                      Price impact {impact === null ? "—" : `${(impact / 100).toFixed(2)}%`} · Fee{" "}
                      {(pool.fee_bps / 100).toFixed(2)}%
                    </p>
                  </div>

                  <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-blue" />
                    Executes a client-signed{" "}
                    <code className="font-mono text-[10px] text-fg">
                      {dir === "buy" ? "token_buy" : "token_sell"}
                    </code>{" "}
                    call directly on the KVP-102 token contract with{" "}
                    <code className="font-mono text-[10px] text-fg">min_out</code> slippage protection.
                  </p>
                </>
              ) : (
                <>
                  <div className="space-y-1.5 rounded-lg border border-border bg-bg p-3 font-mono text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-subtle">Your LP Shares</span>
                      <span className="font-semibold text-fg">
                        {formatTokenAmount(userLpPosition.lpShares, 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-subtle">Pool Share</span>
                      <span className="text-emerald-400">
                        {userLpPosition.sharePct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-subtle">Est. Underlying</span>
                      <span className="text-right text-fg">
                        {formatTokenAmount(userLpPosition.underlying0, KVNC_DECIMALS)} KVNC +{" "}
                        {formatTokenAmount(userLpPosition.underlying1, pool.decimals)}{" "}
                        {pool.symbol}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">LP Shares to Remove</span>
                      <div className="flex gap-1">
                        {[25, 50, 75, 100].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            disabled={swapping || userLpShares <= 0n}
                            onClick={() =>
                              setLpRemoveStr(
                                computeRemoveLiquidityShares(userLpShares, pct).toString(),
                              )
                            }
                            className="rounded border border-border bg-bg px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-gold/40 hover:text-fg disabled:opacity-40"
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      value={lpRemoveStr}
                      onChange={(e) => setLpRemoveStr(e.target.value)}
                      inputMode="numeric"
                      disabled={swapping}
                      className="h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm text-fg outline-none"
                      placeholder={userLpShares > 0n ? userLpShares.toString() : "0"}
                    />
                  </div>

                  <div className="space-y-1 rounded-lg border border-border bg-bg p-3 font-mono text-[11px]">
                    <p className="text-[10px] uppercase tracking-wide text-subtle">
                      Estimated Withdrawal
                    </p>
                    <div className="flex justify-between">
                      <span className="text-muted">KVNC</span>
                      <span className="text-fg">
                        {formatTokenAmount(removeEstimate.underlying0, KVNC_DECIMALS)} KVNC
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">{pool.symbol}</span>
                      <span className="text-fg">
                        {formatTokenAmount(removeEstimate.underlying1, pool.decimals)}{" "}
                        {pool.symbol}
                      </span>
                    </div>
                    <p className="pt-1 text-[10px] text-subtle">
                      Min after {(slippageBps / 100).toFixed(1)}% slippage:{" "}
                      {formatTokenAmount(removeMinKuna, KVNC_DECIMALS)} KVNC +{" "}
                      {formatTokenAmount(removeMinTokens, pool.decimals)} {pool.symbol}
                    </p>
                  </div>
                </>
              )}

              {swapStatus && (
                <div className="flex items-center gap-2 rounded-lg border border-blue/30 bg-blue/10 px-3 py-2 text-xs text-blue">
                  <Loader2 className="size-3.5 shrink-0 animate-spin" />
                  <span>{swapStatus}</span>
                </div>
              )}

              {/* Live Client-Signed Execution */}
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                {activeSigner ? (
                  <>
                    <div className="flex items-center justify-between font-mono text-[10px] text-muted">
                      <span>
                        Signer ({activeSigner.kind === "web-wallet" ? "Web Wallet" : "Extension"})
                      </span>
                      <span className="text-fg">{shortId(activeSigner.addressKvnc)}</span>
                    </div>
                    {panelTab === "swap" ? (
                      <Button
                        type="button"
                        className="w-full"
                        disabled={swapping || pool.paused || out === null || out <= 0n}
                        onClick={() => void onExecuteSwap()}
                      >
                        {swapping ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Signing {dir === "buy" ? "token_buy" : "token_sell"}…
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="mr-2 size-4" />
                            {dir === "buy"
                              ? `Buy ${pool.symbol} with KVNC`
                              : `Sell ${pool.symbol} for KVNC`}
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        className="w-full"
                        variant="outline"
                        disabled={swapping || pool.paused || removeLpShares <= 0n}
                        onClick={() => void onExecuteRemoveLiquidity()}
                      >
                        {swapping ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Signing amm_remove_liquidity…
                          </>
                        ) : (
                          <>
                            <Minus className="mr-2 size-4" />
                            Remove Liquidity ({pool.symbol} / KVNC)
                          </>
                        )}
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted">
                      <Wallet className="size-3.5 text-gold" />
                      <span>Unlock your Web Wallet or connect window.kovanica to swap.</span>
                    </div>
                    <div className="flex gap-2">
                      {hasExtension && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="flex-1 text-xs"
                          onClick={() => void onConnectExtension()}
                        >
                          Connect Extension
                        </Button>
                      )}
                      <Button asChild size="sm" variant="outline" className="flex-1 text-xs">
                        <Link to="/wallet">Unlock Wallet</Link>
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {lastSwap && (
                <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-medium text-emerald-400">
                    <CheckCircle2 className="size-4" />
                    <span>{lastSwap.method} broadcast!</span>
                  </div>
                  <div className="space-y-1 font-mono text-[11px]">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">Tx Hash</span>
                      <span className="truncate text-fg">{shortId(lastSwap.txHash)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">Fee</span>
                      <span className="text-fg">
                        {(Number(lastSwap.fee) / ATOM).toFixed(6)} {TOKEN}
                      </span>
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline" className="w-full text-xs">
                    <Link to="/explorer">
                      <ExternalLink className="mr-1.5 size-3.5" />
                      View in Explorer
                    </Link>
                  </Button>
                </div>
              )}

              <p className="flex items-center gap-1.5 font-mono text-[10px] text-subtle">
                <ArrowDownUp className="size-3" /> LP supply{" "}
                {formatTokenAmount(BigInt(pool.lp_total), 0)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
