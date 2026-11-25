import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Coins,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
  Snowflake,
  UserCheck,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATOM, FIXED_FEES, TOKEN } from "@/lib/networkConstants";
import {
  DEFAULT_RWA_REGISTRY,
  type RwaHolderRow,
  chunkAllowlistEntries,
  computeProRataCouponDistribution,
  formatRwaSupply,
  isPro21AddressFormat,
  validateMintAgainstCap,
} from "@/lib/rwa/compliance";
import { toast } from "sonner";

export const Route = createFileRoute("/wallet/rwa-manage")({
  component: RwaIssuerManagePage,
});

const INITIAL_HOLDERS: RwaHolderRow[] = [
  {
    address: "kvnc11111111111111111111111111111111111111111111111111111111dag",
    balance: 6_500_000_000_000n,
    allowlisted: true,
    kycTier: 2,
    frozen: false,
  },
  {
    address: "kvnc22222222222222222222222222222222222222222222222222222222dag",
    balance: 4_000_000_000_000n,
    allowlisted: true,
    kycTier: 1,
    frozen: false,
  },
  {
    address: "kvnc33333333333333333333333333333333333333333333333333333333dag",
    balance: 2_000_000_000_000n,
    allowlisted: true,
    kycTier: 1,
    frozen: true,
  },
];

function RwaIssuerManagePage() {
  const [selectedAssetId, setSelectedAssetId] = useState(DEFAULT_RWA_REGISTRY[0]!.assetId);
  const [tab, setTab] = useState<"allowlist" | "compliance" | "supply" | "dividends">("allowlist");
  const [holders, setHolders] = useState<RwaHolderRow[]>(INITIAL_HOLDERS);
  const [paused, setPaused] = useState(false);

  // Allowlist batch input
  const [bulkAddresses, setBulkAddresses] = useState("");
  const [kycTier, setKycTier] = useState("1");

  // Compliance: clawback / forced transfer
  const [clawbackFrom, setClawbackFrom] = useState(INITIAL_HOLDERS[2]!.address);
  const [clawbackTo, setClawbackTo] = useState(INITIAL_HOLDERS[0]!.address);
  const [clawbackAmount, setClawbackAmount] = useState("500000000000");
  const [clawbackReason, setClawbackReason] = useState("Court-ordered regulatory recovery #2026-04");

  // Supply: mint / burn with cap check
  const [mintTo, setMintTo] = useState(INITIAL_HOLDERS[0]!.address);
  const [mintAmount, setMintAmount] = useState("1000000000000");
  const [burnAmount, setBurnAmount] = useState("250000000000");

  // Scheduled Coupon / Dividend Distribution (kovanica-scheduler)
  const [payoutKvnc, setPayoutKvnc] = useState("500");
  const [intervalHeights, setIntervalHeights] = useState("21600");
  const [maxRuns, setMaxRuns] = useState("12");
  const [bountyKvnc, setBountyKvnc] = useState("0.05");
  const [couponMemo, setCouponMemo] = useState("Quarterly Treasury Coupon");

  const asset = useMemo(
    () => DEFAULT_RWA_REGISTRY.find((a) => a.assetId === selectedAssetId) ?? DEFAULT_RWA_REGISTRY[0]!,
    [selectedAssetId],
  );

  const totalPayoutAtoms = useMemo(() => {
    const parsed = Number.parseFloat(payoutKvnc);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0n;
    return BigInt(Math.round(parsed * ATOM));
  }, [payoutKvnc]);

  const dividendPlan = useMemo(
    () => computeProRataCouponDistribution(totalPayoutAtoms, holders),
    [totalPayoutAtoms, holders],
  );

  const handleBatchAllowlist = (allowed: boolean) => {
    const lines = bulkAddresses
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast.error("Paste at least one PRO-21 kvnc…dag holder address");
      return;
    }
    const invalid = lines.filter((addr) => !isPro21AddressFormat(addr));
    if (invalid.length > 0) {
      toast.error(`Invalid PRO-21 address: ${invalid[0]}`);
      return;
    }
    const tier = Math.max(0, Math.min(255, Number.parseInt(kycTier, 10) || 1));
    const batches = chunkAllowlistEntries(lines);
    setHolders((prev) => {
      const next = [...prev];
      for (const addr of lines) {
        const idx = next.findIndex((h) => h.address === addr);
        if (idx >= 0) {
          next[idx] = { ...next[idx]!, allowlisted: allowed, kycTier: tier };
        } else {
          next.push({ address: addr, balance: 0n, allowlisted: allowed, kycTier: tier, frozen: false });
        }
      }
      return next;
    });
    setBulkAddresses("");
    toast.success(
      `Prepared ${batches.length} Wave A Batch tx${batches.length > 1 ? "s" : ""} (${lines.length} holder${lines.length > 1 ? "s" : ""} ${allowed ? "allowlisted" : "revoked"})`,
    );
  };

  const handleToggleFreeze = (address: string) => {
    setHolders((prev) =>
      prev.map((h) => (h.address === address ? { ...h, frozen: !h.frozen } : h)),
    );
    const target = holders.find((h) => h.address === address);
    toast.success(
      `Prepared rwa_freeze(${address.slice(0, 12)}…, ${target?.frozen ? "false" : "true"}) via RwaClient`,
    );
  };

  const handleForcedTransfer = () => {
    if (!isPro21AddressFormat(clawbackFrom) || !isPro21AddressFormat(clawbackTo)) {
      toast.error("Both source and destination must be valid PRO-21 kvnc…dag addresses");
      return;
    }
    if (!clawbackReason.trim()) {
      toast.error("Compliance reason metadata is mandatory for forced transfers / clawbacks");
      return;
    }
    toast.success(
      `Prepared rwa_forced_transfer (${clawbackAmount} units) with reason: "${clawbackReason.trim()}"`,
    );
  };

  const handleMintWithCapCheck = () => {
    if (!isPro21AddressFormat(mintTo)) {
      toast.error("Recipient must be a valid PRO-21 kvnc…dag address");
      return;
    }
    let amt: bigint;
    try {
      amt = BigInt(mintAmount.trim());
    } catch {
      toast.error("Enter a valid integer mint amount");
      return;
    }
    const check = validateMintAgainstCap(BigInt(asset.totalSupply), BigInt(asset.maxSupply), amt);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    toast.success(
      `Cap check passed — prepared rwa_mint(${mintTo.slice(0, 12)}…, ${amt.toString()}) (fee ${(FIXED_FEES.rwa_mint / ATOM).toFixed(4)} ${TOKEN})`,
    );
  };

  const handleScheduleDividend = () => {
    if (dividendPlan.eligibleHolders.length === 0 || totalPayoutAtoms <= 0n) {
      toast.error("No eligible allowlisted non-frozen holders or invalid payout amount");
      return;
    }
    toast.success(
      `Prepared kovanica-scheduler job: ${maxRuns}x ${payoutKvnc} ${TOKEN} pro-rata across ${dividendPlan.eligibleHolders.length} holders every ${intervalHeights} heights (bounty ${bountyKvnc} ${TOKEN}/run)`,
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/rwa" className="text-muted hover:text-fg transition-colors">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <p className="font-mono text-[10px] tracking-wide text-purple uppercase">
              KVP-106 Issuer &amp; Compliance Portal · RwaClient v0.8.1
            </p>
            <h1 className="font-display text-2xl tracking-tight text-fg">
              Institutional RWA Management
            </h1>
          </div>
        </div>
        <Link to="/rwa">
          <Button variant="outline" size="sm" className="text-xs">
            Public RWA Registry
          </Button>
        </Link>
      </div>

      {/* Contract Selector & Status Header */}
      <div className="rounded-xl border border-border bg-surface p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex-1 min-w-[240px]">
          <label className="text-[11px] text-muted block mb-1">Managed KVP-106 Contract</label>
          <select
            value={selectedAssetId}
            onChange={(e) => setSelectedAssetId(e.target.value)}
            className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
          >
            {DEFAULT_RWA_REGISTRY.map((a) => (
              <option key={a.assetId} value={a.assetId}>
                {a.symbol} — {a.name} ({a.jurisdiction})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div>
            <div className="text-[10px] text-muted">Supply / Cap</div>
            <div className="text-fg">
              {formatRwaSupply(asset.totalSupply, asset.decimals)} /{" "}
              {asset.maxSupply === "0" ? "∞" : formatRwaSupply(asset.maxSupply, asset.decimals)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted">Transfer State</div>
            <div className={paused ? "text-amber-400" : "text-emerald"}>
              {paused ? "PAUSED" : "ACTIVE"}
            </div>
          </div>
        </div>
      </div>

      {/* Portal Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Button
          variant={tab === "allowlist" ? "default" : "outline"}
          onClick={() => setTab("allowlist")}
          className="text-xs h-10"
        >
          <UserCheck className="size-3.5 mr-1.5" />
          Allowlist / KYC
        </Button>
        <Button
          variant={tab === "compliance" ? "default" : "outline"}
          onClick={() => setTab("compliance")}
          className="text-xs h-10"
        >
          <ShieldAlert className="size-3.5 mr-1.5" />
          Compliance
        </Button>
        <Button
          variant={tab === "supply" ? "default" : "outline"}
          onClick={() => setTab("supply")}
          className="text-xs h-10"
        >
          <Coins className="size-3.5 mr-1.5" />
          Mint / Burn Cap
        </Button>
        <Button
          variant={tab === "dividends" ? "default" : "outline"}
          onClick={() => setTab("dividends")}
          className="text-xs h-10"
        >
          <CalendarClock className="size-3.5 mr-1.5" />
          Coupon Scheduler
        </Button>
      </div>

      {/* Tab 1: Allowlist / KYC */}
      {tab === "allowlist" && (
        <div className="rounded-xl border border-border bg-surface p-6 space-y-5">
          <div>
            <h2 className="font-medium text-fg">
              Allowlist / KYC Batch Management (Wave A Atomic Batch)
            </h2>
            <p className="text-xs text-muted mt-1">
              Add or revoke up to 16 verified PRO-21 <code className="font-mono">kvnc…dag</code>{" "}
              holders per atomic Wave A Batch transaction.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-3">
              <label className="text-xs text-muted block mb-1">
                Holder Addresses (one per line or comma-separated)
              </label>
              <textarea
                rows={3}
                value={bulkAddresses}
                onChange={(e) => setBulkAddresses(e.target.value)}
                placeholder="kvnc1111...dag"
                className="w-full rounded-md border border-border bg-bg p-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">KYC Tier (0–255)</label>
              <input
                value={kycTier}
                onChange={(e) => setKycTier(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => handleBatchAllowlist(true)} className="text-xs">
              <Zap className="size-3.5 mr-1.5" />
              Batch Approve Allowlist (Wave A)
            </Button>
            <Button
              variant="outline"
              onClick={() => handleBatchAllowlist(false)}
              className="text-xs"
            >
              Batch Revoke Allowlist
            </Button>
          </div>

          <div className="border-t border-border pt-4 space-y-2">
            <h3 className="text-xs font-medium text-muted uppercase font-mono">
              Current Verified Holders ({holders.length})
            </h3>
            <div className="divide-y divide-border/60 rounded-lg border border-border bg-bg/50">
              {holders.map((h) => (
                <div
                  key={h.address}
                  className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
                >
                  <span className="text-fg">
                    {h.address.slice(0, 14)}…{h.address.slice(-8)}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted">Tier {h.kycTier}</span>
                    <span className={h.allowlisted ? "text-emerald" : "text-muted"}>
                      {h.allowlisted ? "KYC VERIFIED" : "REVOKED"}
                    </span>
                    <span className={h.frozen ? "text-amber-400" : "text-muted"}>
                      {h.frozen ? "FROZEN" : "ACTIVE"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Compliance Controls */}
      {tab === "compliance" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-medium text-fg">Global Asset Transfer Pause</h2>
              <p className="text-xs text-muted mt-1">
                Emergency circuit breaker pausing all secondary transfers, mints, and redemptions.
              </p>
            </div>
            <Button
              variant={paused ? "default" : "outline"}
              onClick={() => {
                setPaused((p) => !p);
                toast.success(`Prepared rwa_set_paused(${!paused}) for ${asset.symbol}`);
              }}
            >
              {paused ? (
                <>
                  <PlayCircle className="size-4 mr-1.5" />
                  Unpause Transfers
                </>
              ) : (
                <>
                  <PauseCircle className="size-4 mr-1.5" />
                  Pause Transfers
                </>
              )}
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-surface p-6 space-y-3">
            <h2 className="font-medium text-fg">Account Freeze / Unfreeze</h2>
            <div className="divide-y divide-border/60 rounded-lg border border-border bg-bg/50">
              {holders.map((h) => (
                <div
                  key={h.address}
                  className="px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <span className="font-mono text-fg">
                    {h.address.slice(0, 16)}…{h.address.slice(-8)}
                  </span>
                  <Button
                    size="sm"
                    variant={h.frozen ? "default" : "outline"}
                    onClick={() => handleToggleFreeze(h.address)}
                    className="text-xs h-7"
                  >
                    <Snowflake className="size-3 mr-1" />
                    {h.frozen ? "Unfreeze" : "Freeze Account"}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
            <div>
              <h2 className="font-medium text-fg">Forced Transfer / Regulatory Clawback</h2>
              <p className="text-xs text-muted mt-1">
                Issuer-only recovery transfer with immutable on-chain reason metadata.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted block mb-1">From Holder (PRO-21)</label>
                <input
                  value={clawbackFrom}
                  onChange={(e) => setClawbackFrom(e.target.value)}
                  className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">To Custody / Recovery (PRO-21)</label>
                <input
                  value={clawbackTo}
                  onChange={(e) => setClawbackTo(e.target.value)}
                  className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Amount (base units)</label>
                <input
                  value={clawbackAmount}
                  onChange={(e) => setClawbackAmount(e.target.value)}
                  className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Reason Metadata (Required)</label>
                <input
                  value={clawbackReason}
                  onChange={(e) => setClawbackReason(e.target.value)}
                  className="w-full h-10 rounded-md border border-border bg-bg px-3 text-xs text-fg"
                />
              </div>
            </div>
            <Button onClick={handleForcedTransfer} className="w-full">
              Prepare Forced Transfer / Clawback
            </Button>
          </div>
        </div>
      )}

      {/* Tab 3: Mint / Burn Cap Enforcement */}
      {tab === "supply" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
            <h2 className="font-medium text-fg">Mint RWA Shares (Cap-Enforced)</h2>
            <div>
              <label className="text-xs text-muted block mb-1">Recipient (PRO-21)</label>
              <input
                value={mintTo}
                onChange={(e) => setMintTo(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Mint Amount (base units)</label>
              <input
                value={mintAmount}
                onChange={(e) => setMintAmount(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <Button className="w-full" onClick={handleMintWithCapCheck}>
              <CheckCircle2 className="size-4 mr-1.5" />
              Verify Cap &amp; Prepare Mint
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
            <h2 className="font-medium text-fg">Burn / Redeem RWA Shares</h2>
            <div>
              <label className="text-xs text-muted block mb-1">Burn Amount (base units)</label>
              <input
                value={burnAmount}
                onChange={(e) => setBurnAmount(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => toast.success(`Prepared rwa_burn(${burnAmount}) for ${asset.symbol}`)}
            >
              Prepare Redemption Burn
            </Button>
          </div>
        </div>
      )}

      {/* Tab 4: Automated Coupon / Dividend Distribution (kovanica-scheduler) */}
      {tab === "dividends" && (
        <div className="rounded-xl border border-border bg-surface p-6 space-y-5">
          <div>
            <h2 className="font-medium text-fg">
              Automated Coupon / Dividend Distribution (`kovanica-scheduler`)
            </h2>
            <p className="text-xs text-muted mt-1">
              Schedule recurring pro-rata payouts to allowlisted, non-frozen holders via Wave C
              keeper jobs.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted block mb-1">Total Coupon Payout ({TOKEN})</label>
              <input
                value={payoutKvnc}
                onChange={(e) => setPayoutKvnc(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Interval (Block Heights)</label>
              <input
                value={intervalHeights}
                onChange={(e) => setIntervalHeights(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Max Recurring Runs</label>
              <input
                value={maxRuns}
                onChange={(e) => setMaxRuns(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Keeper Bounty / Run ({TOKEN})</label>
              <input
                value={bountyKvnc}
                onChange={(e) => setBountyKvnc(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted block mb-1">Distribution Memo</label>
              <input
                value={couponMemo}
                onChange={(e) => setCouponMemo(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 text-xs text-fg"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-bg/50 p-3 space-y-2">
            <div className="flex justify-between text-xs text-muted">
              <span>Pro-Rata Preview (Excludes Frozen / Non-Allowlisted)</span>
              <span className="font-mono text-fg">
                {dividendPlan.eligibleHolders.length} eligible holders
              </span>
            </div>
            {dividendPlan.eligibleHolders.map((row) => (
              <div
                key={row.address}
                className="flex items-center justify-between text-xs font-mono"
              >
                <span className="text-muted">
                  {row.address.slice(0, 14)}…{row.address.slice(-6)} ({row.sharePct.toFixed(2)}%)
                </span>
                <span className="text-emerald">
                  {(Number(row.payoutAtoms) / ATOM).toFixed(4)} {TOKEN}
                </span>
              </div>
            ))}
          </div>

          <Button className="w-full" onClick={handleScheduleDividend}>
            <CalendarClock className="size-4 mr-1.5" />
            Schedule Recurring Coupon Job (`kovanica-scheduler`)
          </Button>
        </div>
      )}
    </div>
  );
}
