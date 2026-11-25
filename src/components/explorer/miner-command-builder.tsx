import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Lock,
  Terminal,
} from "lucide-react";
import {
  EXAMPLE_PRO21_PAYOUT_ADDRESS,
  MINER_CONSENSUS_SPECS,
  MINER_NETWORK_SPECS,
  buildKovanicaMinerCommand,
  type MinerMode,
  type MinerNetwork,
} from "@/lib/explorer/miner-command";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type MinerCommandBuilderProps = {
  defaultOpen?: boolean;
  defaultNetwork?: MinerNetwork;
};

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to textarea fallback when clipboard API is unavailable
    }
  }
  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (copied) return true;
    } catch {
      // Ignore fallback failures in restricted contexts
    }
  }
  return false;
}

/**
 * Collapsible KovanicaHash Miner & Stratum TLS Command Builder.
 *
 * Lets operators configure Stratum TLS or Solo RPC flags and copy a validated,
 * shell-safe `kovanica mine ...` CLI command without leaving the telemetry view.
 */
export function MinerCommandBuilder({
  defaultOpen = false,
  defaultNetwork = "testnet",
}: MinerCommandBuilderProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<MinerMode>("stratum");
  const [network, setNetwork] = useState<MinerNetwork>(defaultNetwork);
  const [endpoint, setEndpoint] = useState<string>(
    MINER_NETWORK_SPECS[defaultNetwork].defaultStratumEndpoint,
  );
  const [payoutAddress, setPayoutAddress] = useState<string>(EXAMPLE_PRO21_PAYOUT_ADDRESS);
  const [workerName, setWorkerName] = useState<string>("rig1");
  const [threadsInput, setThreadsInput] = useState<string>("4");
  const [tls, setTls] = useState<boolean>(true);
  const [tlsServerName, setTlsServerName] = useState<string>("");
  const [tlsCaCert, setTlsCaCert] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const parsedThreads = useMemo(() => {
    const trimmed = threadsInput.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : Number.NaN;
  }, [threadsInput]);

  const result = useMemo(
    () =>
      buildKovanicaMinerCommand({
        mode,
        network,
        endpoint,
        payoutAddress,
        workerName: mode === "stratum" ? workerName : undefined,
        threads: parsedThreads,
        tls: mode === "stratum" ? tls : undefined,
        tlsServerName: mode === "stratum" && tls ? tlsServerName : undefined,
        tlsCaCert: mode === "stratum" && tls ? tlsCaCert : undefined,
      }),
    [mode, network, endpoint, payoutAddress, workerName, parsedThreads, tls, tlsServerName, tlsCaCert],
  );

  const handleModeChange = useCallback(
    (nextMode: MinerMode) => {
      setMode(nextMode);
      const spec = MINER_NETWORK_SPECS[network];
      if (nextMode === "stratum") {
        setEndpoint(tls ? spec.defaultStratumEndpoint : "stratum+tcp://pool.kovanica.online:3333");
      } else {
        setEndpoint(spec.defaultRpcEndpoint);
      }
    },
    [network, tls],
  );

  const handleNetworkChange = useCallback(
    (nextNetwork: MinerNetwork) => {
      setNetwork(nextNetwork);
      const spec = MINER_NETWORK_SPECS[nextNetwork];
      setEndpoint(mode === "stratum" ? spec.defaultStratumEndpoint : spec.defaultRpcEndpoint);
    },
    [mode],
  );

  const handleTlsToggle = useCallback(() => {
    setTls((prev) => {
      const next = !prev;
      setEndpoint((curr) => {
        if (next && curr.startsWith("stratum+tcp://")) {
          return `stratum+tls://${curr.slice("stratum+tcp://".length)}`;
        }
        if (!next && curr.startsWith("stratum+tls://")) {
          return `stratum+tcp://${curr.slice("stratum+tls://".length)}`;
        }
        return curr;
      });
      return next;
    });
  }, []);

  const handleCopy = useCallback(async () => {
    if (!result.ok) return;
    await copyTextToClipboard(result.command);
    setCopied(true);
    if (copiedTimerRef.current !== null) {
      clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, 2000);
  }, [result]);

  const activeSpec = MINER_NETWORK_SPECS[network];

  return (
    <div
      data-testid="miner-command-builder"
      className="mt-3 rounded-lg border border-border bg-bg/90"
    >
      {/* Collapsible header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
        <button
          type="button"
          data-testid="miner-command-builder-toggle"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className="inline-flex items-center gap-2 text-left text-fg transition-colors hover:text-gold"
        >
          {open ? (
            <ChevronUp className="size-4 text-subtle" />
          ) : (
            <ChevronDown className="size-4 text-subtle" />
          )}
          <Terminal className="size-4 text-gold" />
          <span className="font-display text-sm font-medium tracking-tight">
            KovanicaHash Miner &amp; Stratum TLS Command Builder
          </span>
        </button>

        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
          <span className="rounded-full border border-border bg-surface/60 px-2 py-0.5 text-muted">
            {MINER_CONSENSUS_SPECS.powAlgorithm} · GHOSTDAG K={MINER_CONSENSUS_SPECS.ghostdagK} ·{" "}
            {MINER_CONSENSUS_SPECS.targetBlockTimeSec}s
          </span>
          <span className="hidden rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-gold sm:inline-flex">
            NoStake82M · {MINER_CONSENSUS_SPECS.initialRewardKvnc} KVNC
          </span>
        </div>
      </div>

      {open ? (
        <div className="space-y-3.5 border-t border-border/70 px-3.5 py-3.5">
          {/* Mode + Network row */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <span className="mb-1.5 block text-[10px] font-medium tracking-wider text-subtle uppercase">
                Mining Mode
              </span>
              <div className="grid grid-cols-2 gap-1.5 rounded-md border border-border bg-surface/50 p-1">
                <button
                  type="button"
                  data-testid="miner-mode-stratum"
                  aria-pressed={mode === "stratum"}
                  onClick={() => handleModeChange("stratum")}
                  className={cn(
                    "rounded px-2.5 py-1.5 font-mono text-xs font-medium transition-colors",
                    mode === "stratum"
                      ? "bg-gold/15 text-gold"
                      : "text-muted hover:text-fg",
                  )}
                >
                  Stratum TLS
                </button>
                <button
                  type="button"
                  data-testid="miner-mode-solo"
                  aria-pressed={mode === "solo"}
                  onClick={() => handleModeChange("solo")}
                  className={cn(
                    "rounded px-2.5 py-1.5 font-mono text-xs font-medium transition-colors",
                    mode === "solo"
                      ? "bg-gold/15 text-gold"
                      : "text-muted hover:text-fg",
                  )}
                >
                  Solo RPC
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="miner-network-select"
                className="mb-1.5 block text-[10px] font-medium tracking-wider text-subtle uppercase"
              >
                Network
              </label>
              <select
                id="miner-network-select"
                data-testid="miner-network-select"
                value={network}
                onChange={(e) => handleNetworkChange(e.target.value as MinerNetwork)}
                className="h-9 w-full rounded-md border border-border bg-surface/60 px-2.5 font-mono text-xs text-fg focus:border-gold focus:outline-none"
              >
                <option value="testnet">Testnet (Chain 2 · 2-24cdb5fadd98b207)</option>
                <option value="mainnet">Mainnet (Chain 1 · 1-f35df34c92001436)</option>
              </select>
            </div>
          </div>

          {/* Payout Address & Endpoint */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label
                htmlFor="miner-address-input"
                className="mb-1.5 block text-[10px] font-medium tracking-wider text-subtle uppercase"
              >
                Payout Address (PRO-21)
              </label>
              <input
                id="miner-address-input"
                data-testid="miner-address-input"
                type="text"
                value={payoutAddress}
                onChange={(e) => setPayoutAddress(e.target.value)}
                placeholder="kvnc…dag"
                spellCheck={false}
                className="h-9 w-full rounded-md border border-border bg-surface/60 px-2.5 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="miner-endpoint-input"
                className="mb-1.5 block text-[10px] font-medium tracking-wider text-subtle uppercase"
              >
                {mode === "stratum" ? "Stratum Pool Endpoint" : "Solo Node RPC URL"}
              </label>
              <input
                id="miner-endpoint-input"
                data-testid="miner-endpoint-input"
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={
                  mode === "stratum"
                    ? "stratum+tls://pool.kovanica.online:3333"
                    : "http://127.0.0.1:8545"
                }
                spellCheck={false}
                className="h-9 w-full rounded-md border border-border bg-surface/60 px-2.5 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold focus:outline-none"
              />
              {mode === "stratum" && (
                <p className="mt-1 text-[11px] text-subtle">
                  Placeholder endpoint: <code className="font-mono">pool.kovanica.online:3333</code> is an example Stratum host (no public pool DNS is hosted at <code className="font-mono">pool.kovanica.online</code>) — replace with your pool host and port.
                </p>
              )}
            </div>
          </div>

          {/* Worker, Threads, TLS toggle */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {mode === "stratum" ? (
              <div>
                <label
                  htmlFor="miner-worker-input"
                  className="mb-1.5 block text-[10px] font-medium tracking-wider text-subtle uppercase"
                >
                  Worker Name
                </label>
                <input
                  id="miner-worker-input"
                  data-testid="miner-worker-input"
                  type="text"
                  value={workerName}
                  onChange={(e) => setWorkerName(e.target.value)}
                  placeholder="rig1"
                  spellCheck={false}
                  className="h-9 w-full rounded-md border border-border bg-surface/60 px-2.5 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold focus:outline-none"
                />
              </div>
            ) : null}

            <div>
              <label
                htmlFor="miner-threads-input"
                className="mb-1.5 block text-[10px] font-medium tracking-wider text-subtle uppercase"
              >
                CPU Threads
              </label>
              <input
                id="miner-threads-input"
                data-testid="miner-threads-input"
                type="number"
                min={1}
                max={256}
                step={1}
                value={threadsInput}
                onChange={(e) => setThreadsInput(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface/60 px-2.5 font-mono text-xs text-fg focus:border-gold focus:outline-none"
              />
            </div>

            {mode === "stratum" ? (
              <div className="flex flex-col justify-end">
                <button
                  type="button"
                  data-testid="miner-tls-toggle"
                  aria-pressed={tls}
                  onClick={handleTlsToggle}
                  className={cn(
                    "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 font-mono text-xs font-medium transition-colors",
                    tls
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : "border-border bg-surface/60 text-muted hover:text-fg",
                  )}
                >
                  <Lock className="size-3.5" />
                  <span>{tls ? "Stratum TLS: Enabled" : "Stratum TLS: Off"}</span>
                </button>
              </div>
            ) : null}
          </div>

          {/* Optional TLS SNI & CA Cert inputs */}
          {mode === "stratum" && tls ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label
                  htmlFor="miner-tls-sni-input"
                  className="mb-1.5 block text-[10px] font-medium tracking-wider text-subtle uppercase"
                >
                  TLS Server Name / SNI (Optional)
                </label>
                <input
                  id="miner-tls-sni-input"
                  data-testid="miner-tls-sni-input"
                  type="text"
                  value={tlsServerName}
                  onChange={(e) => setTlsServerName(e.target.value)}
                  placeholder="pool.kovanica.online"
                  spellCheck={false}
                  className="h-9 w-full rounded-md border border-border bg-surface/60 px-2.5 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="miner-tls-ca-input"
                  className="mb-1.5 block text-[10px] font-medium tracking-wider text-subtle uppercase"
                >
                  TLS CA Cert PEM Path (Optional)
                </label>
                <input
                  id="miner-tls-ca-input"
                  data-testid="miner-tls-ca-input"
                  type="text"
                  value={tlsCaCert}
                  onChange={(e) => setTlsCaCert(e.target.value)}
                  placeholder="/etc/kovanica/stratum-ca.pem"
                  spellCheck={false}
                  className="h-9 w-full rounded-md border border-border bg-surface/60 px-2.5 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold focus:outline-none"
                />
              </div>
            </div>
          ) : null}

          {/* Live CLI Preview & Copy Action */}
          <div className="rounded-md border border-border/80 bg-surface/60 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-subtle">
                <span>Chain {activeSpec.chainId}</span>
                {activeSpec.networkTag ? <span>· Tag {activeSpec.networkTag}</span> : null}
                <span>
                  · {MINER_CONSENSUS_SPECS.blocksPerEra.toLocaleString()} blk/era (
                  {MINER_CONSENSUS_SPECS.eraDecayNumerator}/{MINER_CONSENSUS_SPECS.eraDecayDenominator}{" "}
                  decay)
                </span>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="copy-miner-command-btn"
                disabled={!result.ok}
                onClick={() => void handleCopy()}
                className="h-7 gap-1.5 text-xs"
              >
                {copied ? (
                  <>
                    <Check className="size-3.5 text-emerald-400" />
                    <span>Command Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" />
                    <span>Copy CLI Command</span>
                  </>
                )}
              </Button>
            </div>

            {result.ok ? (
              <pre
                data-testid="miner-command-preview"
                className="overflow-x-auto whitespace-pre-wrap break-all rounded border border-border/60 bg-bg px-3 py-2 font-mono text-[11px] leading-relaxed text-fg"
              >
                {result.command}
              </pre>
            ) : (
              <div
                data-testid="miner-command-preview"
                role="alert"
                className="flex items-start gap-2 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{result.error}</span>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
