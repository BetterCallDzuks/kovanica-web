import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Copy, Terminal } from "lucide-react";
import {
  CLI_COMMANDS,
  CLI_NETWORK_SPECS,
  DEFAULT_RPC_PROBE_TIMEOUT_SECS,
  EXAMPLE_AIRGAP_ENVELOPE,
  EXAMPLE_KEYFILE_PATH,
  EXAMPLE_RAW_TX_HEX,
  buildCliCommand,
  type AirgapTxKind,
  type CliCommandId,
  type CliNetwork,
  type TxEnvelopeMode,
} from "@/lib/docs/cli-cheatsheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CliCheatsheetProps {
  defaultNetwork?: CliNetwork;
}

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

const NETWORK_ORDER: readonly CliNetwork[] = ["testnet", "mainnet", "devnet"];
const AIRGAP_KINDS: readonly AirgapTxKind[] = ["transfer", "call", "raw"];

export function CliCheatsheet({ defaultNetwork = "testnet" }: CliCheatsheetProps) {
  const [commandId, setCommandId] = useState<CliCommandId>("node-doctor");
  const [network, setNetwork] = useState<CliNetwork>(defaultNetwork);
  const [jsonOutput, setJsonOutput] = useState<boolean>(false);
  const [includeChainCheck, setIncludeChainCheck] = useState<boolean>(true);

  // Command-specific editable parameters
  const [rpcUrl, setRpcUrl] = useState<string>(
    CLI_NETWORK_SPECS[defaultNetwork].defaultRpcUrl,
  );
  const [stratumHealthUrl, setStratumHealthUrl] = useState<string>("");
  const [timeoutInput, setTimeoutInput] = useState<string>(
    String(DEFAULT_RPC_PROBE_TIMEOUT_SECS),
  );
  const [snapshotPath, setSnapshotPath] = useState<string>(
    CLI_NETWORK_SPECS[defaultNetwork].defaultSnapshotPath,
  );
  const [rawTxHex, setRawTxHex] = useState<string>(EXAMPLE_RAW_TX_HEX);
  const [envelopeMode, setEnvelopeMode] = useState<TxEnvelopeMode>("encode");
  const [envelopeKind, setEnvelopeKind] = useState<AirgapTxKind>("transfer");
  const [signingHash, setSigningHash] = useState<string>("");
  const [envelopePayload, setEnvelopePayload] = useState<string>(EXAMPLE_AIRGAP_ENVELOPE);
  const [keyfilePath, setKeyfilePath] = useState<string>(EXAMPLE_KEYFILE_PATH);

  const [copied, setCopied] = useState<boolean>(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleNetworkChange = useCallback((nextNetwork: CliNetwork) => {
    setNetwork(nextNetwork);
    const nextSpec = CLI_NETWORK_SPECS[nextNetwork];
    setRpcUrl(nextSpec.defaultRpcUrl);
    setSnapshotPath(nextSpec.defaultSnapshotPath);
  }, []);

  const parsedTimeoutSecs = useMemo(() => {
    const trimmed = timeoutInput.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : Number.NaN;
  }, [timeoutInput]);

  const result = useMemo(() => {
    switch (commandId) {
      case "node-doctor":
        return buildCliCommand({
          command: "node-doctor",
          network,
          rpcUrl,
          stratumHealthUrl,
          includeExpectedChainId: includeChainCheck,
          json: jsonOutput,
        });
      case "rpc-probe":
        return buildCliCommand({
          command: "rpc-probe",
          network,
          rpcUrl,
          timeoutSecs: parsedTimeoutSecs,
          includeExpectedChainId: includeChainCheck,
          json: jsonOutput,
        });
      case "snapshot-verify":
        return buildCliCommand({
          command: "snapshot-verify",
          network,
          snapshotPath,
          includeExpectedChainId: includeChainCheck,
          json: jsonOutput,
        });
      case "tx-decode":
        return buildCliCommand({
          command: "tx-decode",
          network,
          rawTxHex,
          includeChainId: includeChainCheck,
          json: jsonOutput,
        });
      case "tx-envelope":
        return buildCliCommand({
          command: "tx-envelope",
          network,
          mode: envelopeMode,
          rawTxHex,
          kind: envelopeKind,
          signingHash,
          envelope: envelopePayload,
          includeExpectedChainId: includeChainCheck,
          json: jsonOutput,
        });
      case "key-inspect":
        return buildCliCommand({
          command: "key-inspect",
          keyfilePath,
          json: jsonOutput,
        });
    }
  }, [
    commandId,
    network,
    rpcUrl,
    stratumHealthUrl,
    parsedTimeoutSecs,
    snapshotPath,
    rawTxHex,
    envelopeMode,
    envelopeKind,
    signingHash,
    envelopePayload,
    keyfilePath,
    includeChainCheck,
    jsonOutput,
  ]);

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

  const activeCommand =
    CLI_COMMANDS.find((c) => c.id === commandId) ?? CLI_COMMANDS[0];
  const activeNetworkSpec = CLI_NETWORK_SPECS[network];
  const usesNetwork = commandId !== "key-inspect";
  const supportsChainCheckToggle =
    usesNetwork && !(commandId === "tx-envelope" && envelopeMode === "encode");

  return (
    <div
      data-testid="cli-cheatsheet"
      className="mt-4 overflow-hidden rounded-xl border border-border bg-surface/60"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-amber-400" aria-hidden="true" />
          <span className="font-display text-sm font-medium tracking-tight text-fg">
            Interactive CLI Cheat-Sheet
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase",
              activeCommand.mode === "Offline"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400",
            )}
          >
            {activeCommand.mode}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {usesNetwork ? (
            <div
              role="group"
              aria-label="Network preset"
              className="inline-flex rounded-lg border border-border bg-bg p-0.5 font-mono text-[11px]"
            >
              {NETWORK_ORDER.map((net) => {
                const spec = CLI_NETWORK_SPECS[net];
                const active = network === net;
                return (
                  <button
                    key={net}
                    type="button"
                    data-testid={`cli-network-${net}`}
                    aria-pressed={active}
                    onClick={() => handleNetworkChange(net)}
                    className={cn(
                      "rounded-md px-2.5 py-1 transition-colors",
                      active
                        ? "bg-amber-500/15 text-amber-400"
                        : "text-muted hover:text-fg",
                    )}
                  >
                    {spec.shortLabel} ({spec.chainId})
                  </button>
                );
              })}
            </div>
          ) : null}

          <button
            type="button"
            data-testid="cli-json-toggle"
            aria-pressed={jsonOutput}
            onClick={() => setJsonOutput((prev) => !prev)}
            className={cn(
              "rounded-lg border px-2.5 py-1 font-mono text-[11px] transition-colors",
              jsonOutput
                ? "border-amber-500/40 bg-amber-500/15 text-amber-400"
                : "border-border bg-bg text-muted hover:text-fg",
            )}
          >
            --json {jsonOutput ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* Command tabs */}
      <div
        role="tablist"
        aria-label="Kovanica CLI commands"
        className="flex gap-1.5 overflow-x-auto border-b border-border bg-bg/40 px-4 py-2"
      >
        {CLI_COMMANDS.map((cmd) => {
          const active = cmd.id === commandId;
          return (
            <button
              key={cmd.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`cli-tab-${cmd.id}`}
              onClick={() => setCommandId(cmd.id)}
              className={cn(
                "shrink-0 rounded-md border px-2.5 py-1.5 font-mono text-xs transition-colors",
                active
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-400"
                  : "border-transparent bg-transparent text-muted hover:border-border hover:bg-surface hover:text-fg",
              )}
            >
              {cmd.label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-xs leading-relaxed text-muted">{activeCommand.summary}</p>
          {usesNetwork && activeNetworkSpec.networkTag ? (
            <span className="shrink-0 rounded border border-border bg-bg px-2 py-0.5 font-mono text-[10px] text-muted">
              tag {activeNetworkSpec.networkTag}
            </span>
          ) : null}
        </div>

        {/* Dynamic parameter inputs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(commandId === "node-doctor" || commandId === "rpc-probe") && (
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                JSON-RPC URL
              </span>
              <input
                type="text"
                data-testid="cli-input-rpc-url"
                value={rpcUrl}
                onChange={(e) => setRpcUrl(e.target.value)}
                placeholder="https://rpc-testnet.kovanica.online"
                className="rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-amber-500/50"
              />
            </label>
          )}

          {commandId === "node-doctor" && (
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                Stratum Health URL (optional)
              </span>
              <input
                type="text"
                data-testid="cli-input-stratum-url"
                value={stratumHealthUrl}
                onChange={(e) => setStratumHealthUrl(e.target.value)}
                placeholder={activeNetworkSpec.defaultStratumHealthUrl}
                className="rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-amber-500/50"
              />
            </label>
          )}

          {commandId === "rpc-probe" && (
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                Timeout (seconds, default 10)
              </span>
              <input
                type="number"
                min={1}
                max={300}
                data-testid="cli-input-timeout"
                value={timeoutInput}
                onChange={(e) => setTimeoutInput(e.target.value)}
                className="rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-amber-500/50"
              />
            </label>
          )}

          {commandId === "snapshot-verify" && (
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                Snapshot Directory or Manifest Path
              </span>
              <input
                type="text"
                data-testid="cli-input-snapshot-path"
                value={snapshotPath}
                onChange={(e) => setSnapshotPath(e.target.value)}
                placeholder="./snapshots/testnet/manifest.json"
                className="rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-amber-500/50"
              />
            </label>
          )}

          {commandId === "tx-decode" && (
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                Raw Bincode Transaction Hex
              </span>
              <input
                type="text"
                data-testid="cli-input-raw-tx"
                value={rawTxHex}
                onChange={(e) => setRawTxHex(e.target.value)}
                placeholder={EXAMPLE_RAW_TX_HEX}
                className="rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-amber-500/50"
              />
            </label>
          )}

          {commandId === "tx-envelope" && (
            <>
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                  Envelope Action
                </span>
                <div className="inline-flex w-fit rounded-lg border border-border bg-bg p-0.5 font-mono text-xs">
                  {(["encode", "decode"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      data-testid={`cli-envelope-mode-${m}`}
                      aria-pressed={envelopeMode === m}
                      onClick={() => setEnvelopeMode(m)}
                      className={cn(
                        "rounded-md px-3 py-1 capitalize transition-colors",
                        envelopeMode === m
                          ? "bg-amber-500/15 text-amber-400"
                          : "text-muted hover:text-fg",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {envelopeMode === "encode" ? (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                      Transaction Kind (--kind)
                    </span>
                    <div className="inline-flex w-fit rounded-lg border border-border bg-bg p-0.5 font-mono text-xs">
                      {AIRGAP_KINDS.map((k) => (
                        <button
                          key={k}
                          type="button"
                          data-testid={`cli-envelope-kind-${k}`}
                          aria-pressed={envelopeKind === k}
                          onClick={() => setEnvelopeKind(k)}
                          className={cn(
                            "rounded-md px-2.5 py-1 transition-colors",
                            envelopeKind === k
                              ? "bg-amber-500/15 text-amber-400"
                              : "text-muted hover:text-fg",
                          )}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex flex-col gap-1 sm:col-span-2">
                    <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                      Raw Transaction Hex
                    </span>
                    <input
                      type="text"
                      data-testid="cli-input-envelope-raw-tx"
                      value={rawTxHex}
                      onChange={(e) => setRawTxHex(e.target.value)}
                      placeholder={EXAMPLE_RAW_TX_HEX}
                      className="rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-amber-500/50"
                    />
                  </label>

                  <label className="flex flex-col gap-1 sm:col-span-2">
                    <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                      Signing Hash (optional, 32-byte hex)
                    </span>
                    <input
                      type="text"
                      data-testid="cli-input-signing-hash"
                      value={signingHash}
                      onChange={(e) => setSigningHash(e.target.value)}
                      placeholder="0x… (64 hex characters)"
                      className="rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-amber-500/50"
                    />
                  </label>
                </>
              ) : (
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                    Air-Gap Envelope (kvnc-tx:v1:… or JSON)
                  </span>
                  <input
                    type="text"
                    data-testid="cli-input-envelope-payload"
                    value={envelopePayload}
                    onChange={(e) => setEnvelopePayload(e.target.value)}
                    placeholder={EXAMPLE_AIRGAP_ENVELOPE}
                    className="rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-amber-500/50"
                  />
                </label>
              )}
            </>
          )}

          {commandId === "key-inspect" && (
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                Keystore v2 JSON Path
              </span>
              <input
                type="text"
                data-testid="cli-input-keyfile-path"
                value={keyfilePath}
                onChange={(e) => setKeyfilePath(e.target.value)}
                placeholder="./keystore.json"
                className="rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-amber-500/50"
              />
            </label>
          )}
        </div>

        {supportsChainCheckToggle ? (
          <label className="inline-flex cursor-pointer items-center gap-2 font-mono text-xs text-muted">
            <input
              type="checkbox"
              data-testid="cli-chain-check-toggle"
              checked={includeChainCheck}
              onChange={(e) => setIncludeChainCheck(e.target.checked)}
              className="accent-amber-400"
            />
            Pin {commandId === "tx-decode" ? "--chain-id" : "--expected-chain-id"}{" "}
            {activeNetworkSpec.chainId} ({activeNetworkSpec.shortLabel})
          </label>
        ) : null}

        {/* Command output or validation error */}
        {result.ok ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-3 sm:flex-row sm:items-center sm:justify-between">
            <pre
              data-testid="cli-command-preview"
              className="overflow-x-auto font-mono text-xs leading-relaxed text-amber-300"
            >
              <code>{result.command}</code>
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="cli-copy-button"
              onClick={() => void handleCopy()}
              className="shrink-0 gap-1.5 font-mono text-xs"
            >
              {copied ? (
                <>
                  <Check className="size-3.5 text-emerald-400" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3.5" aria-hidden="true" />
                  Copy
                </>
              )}
            </Button>
          </div>
        ) : (
          <div
            role="alert"
            data-testid="cli-command-error"
            className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2.5 text-xs text-danger"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{result.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
