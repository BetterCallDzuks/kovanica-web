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

  // Bridge state (Wave D #10 — Bitcoin, Solana & All EVM Chains)
  const [bridgeAsset, setBridgeAsset] = useState<string>("wUSDC");
  const [sourceChain, setSourceChain] = useState<string>("8453");
  const [customEvmChainId, setCustomEvmChainId] = useState<string>("");
  const [bridgeAmount, setBridgeAmount] = useState("100");
  const [destAddress, setDestAddress] = useState("");
  const [bridgePreview, setBridgePreview] = useState<string>("");

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
          <p className="font-mono text-[10px] tracking-wide text-purple-400 uppercase">
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
          <h2 className="font-medium text-fg">
            Multi-Chain Bridge (Bitcoin, Solana &amp; All EVM Chains)
          </h2>
          <p className="text-xs text-muted">
            M-of-N threshold relayer bridge minting wrapped KVP-102 assets ({bridgeAsset}) via Wave
            A CPI and burning on outbound withdrawal across BTC, SOL, and any EIP-155 EVM chain.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted block mb-1">Wrapped Asset</label>
              <select
                value={bridgeAsset}
                onChange={(e) => setBridgeAsset(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              >
                <option value="wUSDC">wUSDC (Stablecoin)</option>
                <option value="wUSDT">wUSDT (Stablecoin)</option>
                <option value="wEURC">wEURC (Euro Stablecoin)</option>
                <option value="wBTC">wBTC (Bitcoin)</option>
                <option value="wETH">wETH (Ethereum / L2s)</option>
                <option value="wSOL">wSOL (Solana)</option>
                <option value="wBNB">wBNB (BNB Chain)</option>
                <option value="wPOL">wPOL (Polygon PoS)</option>
                <option value="wAVAX">wAVAX (Avalanche)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">External Network</label>
              <select
                value={sourceChain}
                onChange={(e) => setSourceChain(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              >
                <option value="0">Bitcoin (BTC · Chain 0)</option>
                <option value="501">Solana (SOL · Chain 501)</option>
                <option value="1">Ethereum Mainnet (EVM · 1)</option>
                <option value="8453">Base (EVM · 8453)</option>
                <option value="42161">Arbitrum One (EVM · 42161)</option>
                <option value="10">Optimism (EVM · 10)</option>
                <option value="137">Polygon PoS (EVM · 137)</option>
                <option value="56">BNB Smart Chain (EVM · 56)</option>
                <option value="43114">Avalanche C-Chain (EVM · 43114)</option>
                <option value="59144">Linea (EVM · 59144)</option>
                <option value="534352">Scroll (EVM · 534352)</option>
                <option value="81457">Blast (EVM · 81457)</option>
                <option value="custom-evm">Custom EVM Chain ID…</option>
              </select>
            </div>
            {sourceChain === "custom-evm" && (
              <div className="sm:col-span-2">
                <label className="text-xs text-muted block mb-1">Custom EIP-155 EVM Chain ID</label>
                <input
                  value={customEvmChainId}
                  onChange={(e) => setCustomEvmChainId(e.target.value)}
                  placeholder="e.g. 324 (zkSync), 5000 (Mantle), 100 (Gnosis)"
                  className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
                />
              </div>
            )}
            <div>
              <label className="text-xs text-muted block mb-1">Amount ({bridgeAsset})</label>
              <input
                value={bridgeAmount}
                onChange={(e) => setBridgeAmount(e.target.value)}
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">
                Destination ({sourceChain === "0" ? "BTC bc1/1/3…" : sourceChain === "501" ? "Solana Base58" : "EVM 0x…"})
              </label>
              <input
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                placeholder={
                  sourceChain === "0"
                    ? "bc1q…"
                    : sourceChain === "501"
                      ? "So11111…"
                      : "0x…"
                }
                className="w-full h-10 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg"
              />
            </div>
          </div>
          <Button
            className="w-full"
            onClick={() => {
              const resolvedId =
                sourceChain === "custom-evm" ? Number(customEvmChainId) : Number(sourceChain);
              const addr = destAddress.trim();
              const valid =
                resolvedId === 0
                  ? /^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(addr)
                  : resolvedId === 501
                    ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)
                    : /^0x[0-9a-fA-F]{40}$/.test(addr);
              if (!Number.isFinite(resolvedId) || resolvedId < 0) {
                toast.error("Enter a valid EIP-155 EVM chain ID");
                return;
              }
              if (!valid) {
                toast.error("Invalid destination address format for selected network");
                return;
              }
              setBridgePreview(
                JSON.stringify(
                  {
                    entry: "bridge_request_withdraw",
                    dest_chain_id: resolvedId,
                    asset: bridgeAsset,
                    amount: bridgeAmount,
                    destination: addr,
                  },
                  null,
                  2,
                ),
              );
              toast.success(`Prepared ${bridgeAmount} ${bridgeAsset} withdrawal to chain ${resolvedId}`);
            }}
          >
            Prepare Multi-Chain Withdrawal Payload
          </Button>
          {bridgePreview && (
            <pre className="rounded-lg border border-border bg-bg p-3 font-mono text-[11px] text-fg overflow-x-auto">
              {bridgePreview}
            </pre>
          )}
        </div>
      )}

      {tab === "sessions" && (
        <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-400" />
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
