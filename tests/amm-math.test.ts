import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DEX_POOLS,
  buildWaveAAddLiquidityBatchPlan,
  buildWaveASwapBatchPlan,
  classifyPriceImpact,
  computeLpPosition,
  computeRemoveLiquidityShares,
  computeSwapQuote,
  estimatePoolAprPct,
  formatTokenUnits,
  parseTokenUnits,
} from "../src/lib/amm/math";
import { decodeLpShares, lpSlotHex, priceImpactBps } from "../src/lib/tokens/pool";

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

  it("classifies swap price impact tiers accurately (low <=3%, moderate >3%, high >10%)", () => {
    const low = classifyPriceImpact(0.45);
    assert.equal(low.severity, "low");
    assert.equal(low.warning, null);

    const boundary3 = classifyPriceImpact(3.0);
    assert.equal(boundary3.severity, "low");

    const moderate = classifyPriceImpact(3.01);
    assert.equal(moderate.severity, "moderate");
    assert.ok(moderate.warning && moderate.warning.includes("3%"));

    const boundary10 = classifyPriceImpact(10.0);
    assert.equal(boundary10.severity, "moderate");

    const high = classifyPriceImpact(10.5);
    assert.equal(high.severity, "high");
    assert.ok(high.warning && high.warning.includes("10%"));

    // Verify large trade triggers >10% price impact in both computeSwapQuote and priceImpactBps
    const bigQuote = computeSwapQuote(200_000_000n, 1_000_000_000n, 1_000_000_000n, 50);
    assert.ok(bigQuote && bigQuote.priceImpactPct > 10);
    const bps = priceImpactBps(200_000_000n, 1_000_000_000n, 1_000_000_000n, bigQuote.amountOut);
    assert.ok(bps !== null && bps > 1000);
  });

  it("computes LP share %, underlying reserves, and quick-preset removal shares", () => {
    const pos = computeLpPosition({
      userLpShares: 250_000n,
      totalLpSupply: 1_000_000n,
      reserve0: 40_000_000_000n,
      reserve1: 8_000_000n,
    });
    assert.equal(pos.lpShares, 250_000n);
    assert.equal(pos.sharePct, 25);
    assert.equal(pos.underlying0, 10_000_000_000n);
    assert.equal(pos.underlying1, 2_000_000n);

    // Zero or invalid supply returns zeros safely
    const zeroPos = computeLpPosition({
      userLpShares: 100n,
      totalLpSupply: 0n,
      reserve0: 1000n,
      reserve1: 1000n,
    });
    assert.equal(zeroPos.lpShares, 0n);
    assert.equal(zeroPos.sharePct, 0);
    assert.equal(zeroPos.underlying0, 0n);
    assert.equal(zeroPos.underlying1, 0n);

    // Preset removal shares (25%, 50%, 75%, 100%)
    assert.equal(computeRemoveLiquidityShares(1_000n, 25), 250n);
    assert.equal(computeRemoveLiquidityShares(1_000n, 50), 500n);
    assert.equal(computeRemoveLiquidityShares(1_000n, 75), 750n);
    assert.equal(computeRemoveLiquidityShares(1_000n, 100), 1_000n);
    assert.equal(computeRemoveLiquidityShares(1_000n, 0), 0n);
  });

  it("derives deterministic KVP-102 LP storage slot and decodes u128 LE LP shares", () => {
    const slot = lpSlotHex("0x" + "ab".repeat(32));
    assert.ok(slot && /^[0-9a-f]{64}$/.test(slot));
    assert.equal(lpSlotHex("ab".repeat(32)), slot);
    assert.equal(lpSlotHex("not-hex"), null);

    // Encode 123_456_789n as 16-byte LE u128
    const raw = new Uint8Array(16);
    new DataView(raw.buffer).setBigUint64(0, 123_456_789n, true);
    assert.equal(decodeLpShares(raw), 123_456_789n);
    assert.equal(decodeLpShares(new Uint8Array(8)), null);
  });
});
