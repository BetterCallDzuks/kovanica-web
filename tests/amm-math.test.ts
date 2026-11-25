import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DEX_POOLS,
  buildWaveAAddLiquidityBatchPlan,
  buildWaveASwapBatchPlan,
  computeSwapQuote,
  estimatePoolAprPct,
  formatTokenUnits,
  parseTokenUnits,
} from "../src/lib/amm/math";

describe("Native AMM web math & Wave A batch helpers", () => {
  it("computes constant-product quote with exact 0.30% LP fee", () => {
    const q = computeSwapQuote(10_000_000n, 1_000_000_000n, 1_000_000_000n, 50);
    assert.ok(q);
    assert.equal(q.amountOut, 9_871_580n);
    assert.equal(q.feeAmount, 30_000n);
    assert.equal(q.minAmountOut, (9_871_580n * 9_950n) / 10_000n);
    assert.ok(q.priceImpactPct > 1 && q.priceImpactPct < 1.5);
  });

  it("returns null on zero liquidity or zero input", () => {
    assert.equal(computeSwapQuote(0n, 1000n, 1000n, 50), null);
    assert.equal(computeSwapQuote(100n, 0n, 1000n, 50), null);
  });

  it("estimates annualized APR from 24h volume and TVL", () => {
    const apr = estimatePoolAprPct(100_000, 1_000_000, 30);
    // 100k * 0.003 * 365 / 1M * 100 = 10.95%
    assert.ok(Math.abs(apr - 10.95) < 1e-9);
  });

  it("parses and formats token units accurately", () => {
    assert.equal(parseTokenUnits("12.5", 9), 12_500_000_000n);
    assert.equal(formatTokenUnits(12_500_000_000n, 9), "12.5");
    assert.equal(parseTokenUnits("bad", 9), null);
  });

  it("builds Wave A batch steps skipping approve for native KVNC", () => {
    const pool = DEFAULT_DEX_POOLS[0]!; // KVNC / wUSDC
    const nativeSwapSteps = buildWaveASwapBatchPlan({
      poolId: pool.id,
      tokenIn: pool.token0,
      tokenOut: pool.token1,
      amountIn: 1_000_000_000n,
      minAmountOut: 400_000n,
    });
    assert.equal(nativeSwapSteps.length, 1);
    assert.equal(nativeSwapSteps[0]?.method, "amm_swap_exact_in");

    const kvpSwapSteps = buildWaveASwapBatchPlan({
      poolId: pool.id,
      tokenIn: pool.token1,
      tokenOut: pool.token0,
      amountIn: 1_000_000n,
      minAmountOut: 1_000_000_000n,
    });
    assert.equal(kvpSwapSteps.length, 2);
    assert.equal(kvpSwapSteps[0]?.method, "token_approve");
    assert.equal(kvpSwapSteps[1]?.method, "amm_swap_exact_in");

    const addSteps = buildWaveAAddLiquidityBatchPlan({
      pool,
      amount0: 1_000_000_000n,
      amount1: 500_000n,
    });
    assert.equal(addSteps.length, 2); // 1 approve for wUSDC + 1 amm_add_liquidity
  });
});
