/**
 * Constant-product (x * y = k) Native AMM math & Wave A atomic batch helpers
 * for Kovanica Web (`/swap` and `/pools`).
 */

export const AMM_FEE_NUMERATOR = 997n;
export const AMM_FEE_DENOMINATOR = 1000n;
export const AMM_LP_FEE_BPS = 30;
export const AMM_MINIMUM_LIQUIDITY = 1_000n;

export interface DexToken {
  symbol: string;
  name: string;
  address: string; // "0x00...00" for native KVNC
  decimals: number;
  isNative?: boolean;
}

export interface DexPool {
  id: string;
  token0: DexToken;
  token1: DexToken;
  reserve0: bigint;
  reserve1: bigint;
  totalLpSupply: bigint;
  volume24hUsd: number;
  tvlUsd: number;
  feeBps: number;
}

export const DEFAULT_DEX_TOKENS: readonly DexToken[] = [
  {
    symbol: "KVNC",
    name: "Kovanica Native",
    address: "0".repeat(64),
    decimals: 9,
    isNative: true,
  },
  {
    symbol: "wUSDC",
    name: "Wrapped USD Coin (KVP-20)",
    address: "11".repeat(32),
    decimals: 6,
  },
  {
    symbol: "wETH",
    name: "Wrapped Ether (KVP-20)",
    address: "22".repeat(32),
    decimals: 9,
  },
  {
    symbol: "wBTC",
    name: "Wrapped Bitcoin (KVP-20)",
    address: "33".repeat(32),
    decimals: 8,
  },
];

export const DEFAULT_DEX_POOLS: readonly DexPool[] = [
  {
    id: "amm-kvnc-wusdc",
    token0: DEFAULT_DEX_TOKENS[0]!,
    token1: DEFAULT_DEX_TOKENS[1]!,
    reserve0: 2_500_000_000_000_000n, // 2,500,000 KVNC (9 dec)
    reserve1: 1_250_000_000_000n, // 1,250,000 wUSDC (6 dec)
    totalLpSupply: 55_901_699_437_494n,
    volume24hUsd: 482_500,
    tvlUsd: 2_500_000,
    feeBps: 30,
  },
  {
    id: "amm-kvnc-weth",
    token0: DEFAULT_DEX_TOKENS[0]!,
    token1: DEFAULT_DEX_TOKENS[2]!,
    reserve0: 1_800_000_000_000_000n, // 1,800,000 KVNC
    reserve1: 300_000_000_000n, // 300 wETH (9 dec)
    totalLpSupply: 23_237_900_077_244n,
    volume24hUsd: 215_000,
    tvlUsd: 1_800_000,
    feeBps: 30,
  },
  {
    id: "amm-wusdc-weth",
    token0: DEFAULT_DEX_TOKENS[1]!,
    token1: DEFAULT_DEX_TOKENS[2]!,
    reserve0: 900_000_000_000n, // 900,000 wUSDC
    reserve1: 300_000_000_000n, // 300 wETH
    totalLpSupply: 16_431_676_725_154n,
    volume24hUsd: 310_000,
    tvlUsd: 1_800_000,
    feeBps: 30,
  },
  {
    id: "amm-kvnc-wbtc",
    token0: DEFAULT_DEX_TOKENS[0]!,
    token1: DEFAULT_DEX_TOKENS[3]!,
    reserve0: 1_200_000_000_000_000n, // 1,200,000 KVNC
    reserve1: 600_000_000n, // 6 wBTC (8 dec)
    totalLpSupply: 848_528_137_423n,
    volume24hUsd: 142_000,
    tvlUsd: 1_200_000,
    feeBps: 30,
  },
];

export interface SwapQuoteResult {
  amountOut: bigint;
  minAmountOut: bigint;
  feeAmount: bigint;
  priceImpactPct: number;
}

/** Constant-product quote with 0.30% LP fee. */
export function computeSwapQuote(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  slippageBps: number,
): SwapQuoteResult | null {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return null;
  const amountInWithFee = amountIn * AMM_FEE_NUMERATOR;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * AMM_FEE_DENOMINATOR + amountInWithFee;
  const amountOut = numerator / denominator;
  if (amountOut <= 0n || amountOut >= reserveOut) return null;

  const feeAmount = (amountIn * BigInt(AMM_LP_FEE_BPS)) / 10_000n;
  const clampedSlippage = Math.max(0, Math.min(5000, Math.round(slippageBps)));
  const minAmountOut = (amountOut * BigInt(10_000 - clampedSlippage)) / 10_000n;

  const spotNum = Number(reserveOut) / Number(reserveIn);
  const execNum = Number(amountOut) / Number(amountIn);
  const priceImpactPct =
    spotNum > 0 && execNum < spotNum ? ((spotNum - execNum) / spotNum) * 100 : 0;

  return { amountOut, minAmountOut, feeAmount, priceImpactPct };
}

/** Annualized LP fee APR estimate: `(volume24hUsd * 0.003 * 365) / tvlUsd * 100`. */
export function estimatePoolAprPct(volume24hUsd: number, tvlUsd: number, feeBps = 30): number {
  if (tvlUsd <= 0 || volume24hUsd <= 0) return 0;
  const dailyFees = volume24hUsd * (feeBps / 10_000);
  return ((dailyFees * 365) / tvlUsd) * 100;
}

export function formatTokenUnits(raw: bigint, decimals: number, maxFraction = 4): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  if (frac === 0n) return whole.toLocaleString("en-US");
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return fracStr ? `${whole.toLocaleString("en-US")}.${fracStr}` : whole.toLocaleString("en-US");
}

export function parseTokenUnits(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [wholePart, fracPart = ""] = trimmed.split(".");
  if (fracPart.length > decimals) return null;
  const paddedFrac = fracPart.padEnd(decimals, "0");
  try {
    return BigInt(wholePart!) * 10n ** BigInt(decimals) + BigInt(paddedFrac || "0");
  } catch {
    return null;
  }
}

export interface WaveABatchStep {
  contract: string;
  method: string;
  description: string;
  valueAtoms: string;
}

/** Builds a human-readable 1-tx Wave A atomic Batch plan (`approve + swap` or `approve + add_liquidity`). */
export function buildWaveASwapBatchPlan(params: {
  poolId: string;
  tokenIn: DexToken;
  tokenOut: DexToken;
  amountIn: bigint;
  minAmountOut: bigint;
}): WaveABatchStep[] {
  const steps: WaveABatchStep[] = [];
  if (!params.tokenIn.isNative) {
    steps.push({
      contract: params.tokenIn.address,
      method: "token_approve",
      description: `Approve AMM to spend ${formatTokenUnits(params.amountIn, params.tokenIn.decimals)} ${params.tokenIn.symbol}`,
      valueAtoms: "0",
    });
  }
  steps.push({
    contract: params.poolId,
    method: "amm_swap_exact_in",
    description: `Swap ${formatTokenUnits(params.amountIn, params.tokenIn.decimals)} ${params.tokenIn.symbol} → min ${formatTokenUnits(params.minAmountOut, params.tokenOut.decimals)} ${params.tokenOut.symbol}`,
    valueAtoms: params.tokenIn.isNative ? params.amountIn.toString() : "0",
  });
  return steps;
}

export function buildWaveAAddLiquidityBatchPlan(params: {
  pool: DexPool;
  amount0: bigint;
  amount1: bigint;
}): WaveABatchStep[] {
  const steps: WaveABatchStep[] = [];
  if (!params.pool.token0.isNative) {
    steps.push({
      contract: params.pool.token0.address,
      method: "token_approve",
      description: `Approve ${formatTokenUnits(params.amount0, params.pool.token0.decimals)} ${params.pool.token0.symbol}`,
      valueAtoms: "0",
    });
  }
  if (!params.pool.token1.isNative) {
    steps.push({
      contract: params.pool.token1.address,
      method: "token_approve",
      description: `Approve ${formatTokenUnits(params.amount1, params.pool.token1.decimals)} ${params.pool.token1.symbol}`,
      valueAtoms: "0",
    });
  }
  steps.push({
    contract: params.pool.id,
    method: "amm_add_liquidity",
    description: `Add ${formatTokenUnits(params.amount0, params.pool.token0.decimals)} ${params.pool.token0.symbol} + ${formatTokenUnits(params.amount1, params.pool.token1.decimals)} ${params.pool.token1.symbol}`,
    valueAtoms: params.pool.token0.isNative
      ? params.amount0.toString()
      : params.pool.token1.isNative
        ? params.amount1.toString()
        : "0",
  });
  return steps;
}
