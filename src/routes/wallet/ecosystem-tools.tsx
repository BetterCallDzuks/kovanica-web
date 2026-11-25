import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Clock, ArrowLeftRight, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATOM, FIXED_FEES, TOKEN } from "@/lib/networkConstants";
import { toast } from "sonner";

export const Route = createFileRoute("/wallet/ecosystem-tools")({
  component: EcosystemToolsPage,
});

function EcosystemToolsPage() {
  const [tab, setTab] = useState<"scheduler" | "bridge" | "sessions">("scheduler");

  // Scheduler state (Wave C #9)
  const [targetContract, setTargetContract] = useState("");
  const [method, setMethod] = useState("rwa_mint");
  const [intervalHeights, setIntervalHeights] = useState("2400");
  const [maxRuns, setMaxRuns] = useState("12");
  const [bountyKvnc, setBountyKvnc] = useState("0.05");

  // Bridge state (Wave D #10)
  const [bridgeAsset, setBridgeAsset] = useState<"wUSDC" | "wEURC">("wUSDC");
  const [sourceChain, setSourceChain] = useState<"Ethereum" | "Base" | "Solana">("Base");
  const [bridgeAmount, setBridgeAmount] = useState("100");
  const [destAddress, setDestAddress] = useState("");

  // Passkey & Session Key state (Wave C #7 & #8)
  const [sessionContract, setSessionContract] = useState("");
  const [sessionMethod, setSessionMethod] = useState("nft_mint");
  const [maxSpendKvnc, setMaxSpendKvnc] = useState("5");
  const [durationRounds, setDurationRounds] = useState("21600");

  // Live EIP-1559 Base Fee & Storage Deposit telemetry (Wave B)
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-6 md:py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/wallet" className="text-muted hover:text-fg transition-colors">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <p className="font-mono text-[10px] tracking-wide text-purple uppercase">
            Waves C &amp; D Protocol Suite
          </p>
          <h1 className="font-display text-2xl tracking-tight text-fg">
            Scheduler, Bridge &amp; Session Keys
          </h1>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface/60 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Dynamic Base Fee: <strong className="font-mono text-fg">{baseFeeAtoms} atoms/byte</strong>
        </span>
        <span>
          Refundable Storage Deposit:{" "}
          <strong className="font-mono text-fg">
            {(depositPerByteAtoms / ATOM).toFixed(4)} {TOKEN}/byte
          </strong>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button
          variant={tab === "scheduler" ? "default" : "outline"}
          onClick={() => setTab("scheduler")}
          className="h-10 text-xs"
        >
          <Clock className="size-3.5 mr-1.5" />
          Scheduler
        </Button>
        <Button
          variant={tab === "bridge" ? "default" : "outline"}
          onClick={() => setTab("bridge")}
          className="h-10 text-xs"
        >
          <ArrowLeftRight className="size-3.5 mr-1.5" />
          Bridge
        </Button>
        <Button
          variant={tab === "sessions" ? "default" : "outline"}
          onClick={() => setTab("sessions")}
          className="h-10 text-xs"
        >
          <KeyRound className="size-3.5 mr-1.5" />
          Passkeys / Sessions
        </Button>
      </div>

      {tab === "scheduler" && (
        <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
          <h2 className="font-medium text-fg">On-Chain Recurring Scheduler (kovanica-scheduler)</h2>
          <p className="text-xs text-muted">
            Automate RWA bond coupon payouts, vesting releases, or DCA calls. Keepers trigger due
            jobs via Wave A CPI and earn the per-run KVNC bounty.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-xs text-muted block mb-1">Target Contract</label>
              <input
                value={targetContract}
                onChange={(e) => setTargetContract(e.target.value)}
                placeholder="kvnc…dag or 64-hex"
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Entry Point</label>
              <input
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Interval (heights)</label>
              <input
                value={intervalHeights}
                onChange={(e) => setIntervalHeights(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Max Runs</label>
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
          </div>
          <Button
            className="w-full"
            onClick={() =>
              toast.success(
                `Prepared scheduler_create_job (${maxRuns}x ${method} every ${intervalHeights} heights)`,
              )
            }
          >
            Prepare Scheduled Job
          </Button>
        </div>
      )}

      {tab === "bridge" && (
        <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
          <h2 className="font-medium text-fg">Canonical Stablecoin Bridge (kovanica-bridge)</h2>
          <p className="text-xs text-muted">
            M-of-N threshold relayer bridge minting wrapped KVP-102 stablecoins ({bridgeAsset}) via
            CPI and burning on outbound withdrawal.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted block mb-1">Asset</label>
              <select
                value={bridgeAsset}
                onChange={(e) => setBridgeAsset(e.target.value as "wUSDC" | "wEURC")}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              >
                <option value="wUSDC">wUSDC</option>
                <option value="wEURC">wEURC</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">External Chain</label>
              <select
                value={sourceChain}
                onChange={(e) =>
                  setSourceChain(e.target.value as "Ethereum" | "Base" | "Solana")
                }
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              >
                <option value="Base">Base</option>
                <option value="Ethereum">Ethereum</option>
                <option value="Solana">Solana</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Amount ({bridgeAsset})</label>
              <input
                value={bridgeAmount}
                onChange={(e) => setBridgeAmount(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Destination Address</label>
              <input
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                placeholder="0x… or Solana base58"
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
          </div>
          <Button
            className="w-full"
            onClick={() =>
              toast.success(
                `Prepared bridge_request_withdraw (${bridgeAmount} ${bridgeAsset} → ${sourceChain})`,
              )
            }
          >
            Request Bridge Withdrawal
          </Button>
        </div>
      )}

      {tab === "sessions" && (
        <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald" />
            <h2 className="font-medium text-fg">Passkeys (WebAuthn) &amp; Session Keys</h2>
          </div>
          <p className="text-xs text-muted">
            Create scoped temporary session keys with contract/method allowlists, spending caps, and
            round expiry — or derive a biometric secp256r1 Passkey account.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-xs text-muted block mb-1">Allowed Contract</label>
              <input
                value={sessionContract}
                onChange={(e) => setSessionContract(e.target.value)}
                placeholder="kvnc…dag (leave empty for any)"
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Allowed Method</label>
              <input
                value={sessionMethod}
                onChange={(e) => setSessionMethod(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Max Spend ({TOKEN})</label>
              <input
                value={maxSpendKvnc}
                onChange={(e) => setMaxSpendKvnc(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted block mb-1">Expiry Duration (rounds)</label>
              <input
                value={durationRounds}
                onChange={(e) => setDurationRounds(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-bg p-3 text-xs text-muted">
            Balanced Fixed Fees: Deploy {FIXED_FEES.deploy / ATOM} {TOKEN} • Token{" "}
            {FIXED_FEES.token_create / ATOM} {TOKEN} • NFT Mint {FIXED_FEES.nft_mint / ATOM} {TOKEN}{" "}
            • RWA {FIXED_FEES.rwa_create / ATOM} {TOKEN} (75% burn / 25% miner)
          </div>
          <Button
            className="w-full"
            onClick={() =>
              toast.success(
                `Session policy prepared: ${sessionMethod}, cap ${maxSpendKvnc} ${TOKEN}, +${durationRounds} rounds`,
              )
            }
          >
            Create Scoped Session Policy
          </Button>
        </div>
      )}
    </div>
  );
}
