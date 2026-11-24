import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAddress } from "../src/lib/wallet/address";
import {
  ATOMS_PER_KVNC,
  DEFAULT_LOW_BALANCE_THRESHOLD_ATOMS,
  FAUCET_CANONICAL_NETWORK_TAG,
  formatCooldownRemaining,
  formatFaucetBalanceKvnc,
  parseFaucetTelemetrySummary,
  validateFaucetAddress,
} from "../src/lib/faucet/faucet-telemetry";

function makeSampleKey(seed: number): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = (seed + i * 13) & 0xff;
  }
  return bytes;
}

test("validateFaucetAddress accepts valid kvnc...dag and tknc...dag PRO-21 addresses", () => {
  const kvncAddr = encodeAddress(makeSampleKey(0x11));
  const tkncAddr = `tknc${kvncAddr.slice(4)}`;

  const kvncResult = validateFaucetAddress(kvncAddr);
  assert.equal(kvncResult.valid, true);
  assert.equal(kvncResult.ok, true);
  assert.equal(kvncResult.format, "pro21-mainnet");
  assert.equal(kvncResult.canonicalAddress, kvncAddr);
  assert.equal(kvncResult.networkTag, FAUCET_CANONICAL_NETWORK_TAG);
  assert.equal(kvncResult.reason, undefined);

  const tkncResult = validateFaucetAddress(`  ${tkncAddr.toUpperCase()}  `);
  assert.equal(tkncResult.valid, true);
  assert.equal(tkncResult.ok, true);
  assert.equal(tkncResult.format, "pro21-testnet");
  assert.equal(tkncResult.canonicalAddress, kvncAddr);
  assert.equal(tkncResult.networkTag, FAUCET_CANONICAL_NETWORK_TAG);
  assert.equal(tkncResult.reason, undefined);
});

test("validateFaucetAddress rejects legacy hex, bad checksum, malformed, and XSS inputs", () => {
  const legacyHex = validateFaucetAddress("a".repeat(64));
  assert.equal(legacyHex.valid, false);
  assert.equal(legacyHex.format, "legacy-hex");
  assert.match(legacyHex.reason ?? "", /legacy raw hex/i);

  const kvncAddr = encodeAddress(makeSampleKey(0x42));
  const idx = kvncAddr.length - 4;
  const badChecksum = `${kvncAddr.slice(0, idx)}${kvncAddr[idx] === "q" ? "p" : "q"}${kvncAddr.slice(idx + 1)}`;
  const checksumRes = validateFaucetAddress(badChecksum);
  assert.equal(checksumRes.valid, false);
  assert.equal(checksumRes.format, "invalid");
  assert.match(checksumRes.reason ?? "", /checksum/i);

  const xssRes = validateFaucetAddress("<script>alert(1)</script>");
  assert.equal(xssRes.valid, false);
  assert.equal(xssRes.format, "invalid");
  assert.ok(!(xssRes.reason ?? "").includes("<script>"));

  const emptyRes = validateFaucetAddress("   ");
  assert.equal(emptyRes.valid, false);
  assert.equal(emptyRes.format, "invalid");
});

test("formatCooldownRemaining formats Ready, seconds, minutes+seconds, and hours+minutes", () => {
  assert.equal(formatCooldownRemaining(0), "Ready");
  assert.equal(formatCooldownRemaining(-5000), "Ready");
  assert.equal(formatCooldownRemaining(Number.NaN), "Ready");
  assert.equal(formatCooldownRemaining(Number.POSITIVE_INFINITY), "Ready");

  assert.equal(formatCooldownRemaining(1), "1s");
  assert.equal(formatCooldownRemaining(45_000), "45s");
  assert.equal(formatCooldownRemaining(60_000), "1m");
  assert.equal(formatCooldownRemaining(65_000), "1m 05s");
  assert.equal(formatCooldownRemaining(750_000), "12m 30s");
  assert.equal(formatCooldownRemaining(3_600_000), "1h");
  assert.equal(formatCooldownRemaining(3_900_000), "1h 05m");
  assert.equal(formatCooldownRemaining(7_500_000), "2h 05m");
});

test("parseFaucetTelemetrySummary parses OpenMetrics kovanica_faucet_* payload as Online", () => {
  const openMetrics = [
    "# HELP kovanica_faucet_balance_atoms Current faucet wallet balance in atoms.",
    "# TYPE kovanica_faucet_balance_atoms gauge",
    "kovanica_faucet_balance_atoms 2500000000000",
    "# HELP kovanica_faucet_drips_succeeded_total Total successful faucet dispenses.",
    "# TYPE kovanica_faucet_drips_succeeded_total counter",
    'kovanica_faucet_drips_succeeded_total{network="testnet"} 1482',
    "# TYPE kovanica_faucet_rate_limited_total counter",
    "kovanica_faucet_rate_limited_total 93",
    "# TYPE kovanica_faucet_active_address_cooldowns gauge",
    "kovanica_faucet_active_address_cooldowns 17",
    "# TYPE kovanica_faucet_uptime_seconds gauge",
    "kovanica_faucet_uptime_seconds 86412.5",
    "# EOF",
  ].join("\n");

  const summary = parseFaucetTelemetrySummary(openMetrics);
  assert.equal(summary.status, "online");
  assert.equal(summary.available, true);
  assert.equal(summary.balanceAtoms, 2_500 * ATOMS_PER_KVNC);
  assert.equal(summary.balanceKvnc, 2_500);
  assert.equal(summary.dripsSucceededTotal, 1482);
  assert.equal(summary.rateLimitedTotal, 93);
  assert.equal(summary.activeAddressCooldowns, 17);
  assert.equal(summary.uptimeSeconds, 86412.5);
  assert.equal(formatFaucetBalanceKvnc(summary.balanceAtoms), "2,500 KVNC");
});

test("parseFaucetTelemetrySummary detects Low Balance when below threshold", () => {
  const lowBalanceMetrics = [
    "kovanica_faucet_balance_atoms 50000000000",
    "kovanica_faucet_drips_succeeded_total 42",
    "kovanica_faucet_uptime_seconds 1200",
  ].join("\n");

  const summary = parseFaucetTelemetrySummary(lowBalanceMetrics);
  assert.equal(summary.status, "low_balance");
  assert.equal(summary.available, true);
  assert.equal(summary.balanceAtoms, 50 * ATOMS_PER_KVNC);
  assert.equal(summary.balanceKvnc, 50);
  assert.equal(formatFaucetBalanceKvnc(summary.balanceAtoms), "50 KVNC");

  // Respects custom threshold override
  const customThreshold = parseFaucetTelemetrySummary(lowBalanceMetrics, {
    lowBalanceThresholdAtoms: 10 * ATOMS_PER_KVNC,
  });
  assert.equal(customThreshold.status, "online");
  assert.equal(DEFAULT_LOW_BALANCE_THRESHOLD_ATOMS, 100 * ATOMS_PER_KVNC);
});

test("parseFaucetTelemetrySummary degrades safely to Unavailable on offline, empty, or malformed input", () => {
  const cases = [
    null,
    undefined,
    "",
    "   \n# comment only\n",
    "<html>502 Bad Gateway</html>",
    "unrelated_metric_total 99",
    { available: false, balance_atoms: 500 * ATOMS_PER_KVNC },
  ];

  for (const input of cases) {
    const summary = parseFaucetTelemetrySummary(input);
    assert.equal(summary.status, "unavailable");
    assert.equal(summary.available, false);
    assert.equal(summary.balanceAtoms, null);
    assert.equal(summary.balanceKvnc, null);
    assert.equal(summary.dripsSucceededTotal, null);
    assert.equal(summary.rateLimitedTotal, null);
    assert.equal(summary.activeAddressCooldowns, null);
    assert.equal(summary.uptimeSeconds, null);
  }

  assert.equal(formatFaucetBalanceKvnc(null), "—");
});

test("parseFaucetTelemetrySummary supports structured health input fallback", () => {
  const online = parseFaucetTelemetrySummary({ available: true });
  assert.equal(online.status, "online");
  assert.equal(online.available, true);
  assert.equal(online.balanceAtoms, null);

  const dry = parseFaucetTelemetrySummary({ available: true, lowBalance: true });
  assert.equal(dry.status, "low_balance");
  assert.equal(dry.available, true);
});
