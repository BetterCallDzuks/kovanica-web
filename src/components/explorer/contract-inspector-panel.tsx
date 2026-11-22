import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Code2,
  Copy,
  FileCode,
  Fuel,
  History,
  Link2,
  Play,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Terminal,
} from "lucide-react";
import { ApiError, apiPostJson } from "@/lib/api/client";
import type { ApiSource } from "@/lib/api/contract";
import { Button } from "@/components/ui/button";
import {
  CONTRACT_PRESETS,
  buildContractCurlSnippet,
  buildContractInspectorDeepLink,
  buildContractSdkSnippet,
  decodeContractOutput,
  encodePresetArgs,
  getContractPreset,
  parseContractError,
  parseContractInspectorDeepLink,
  type ContractCallRequest,
  type ContractCallResponse,
  type ContractPresetId,
  type DecodedContractOutput,
} from "@/lib/contracts/dry-run";
import { formatAtomsDisplay } from "@/lib/contracts/decoders";
import { shortId } from "@/lib/ledger/hash";
import { cn } from "@/lib/utils";
import { parseAddr, toCanonicalAddress } from "@/lib/wallet/address";

export type ContractInspectorPanelProps = {
  source: ApiSource;
  initialContract?: string | null;
  initialPreset?: ContractPresetId | null;
  initialFields?: Record<string, string> | null;
};

type DryRunHistoryItem = {
  id: string;
  timestamp: number;
  presetId: ContractPresetId;
  contractAddress: string;
  entry: string;
  fields: Record<string, string>;
  caller: string;
  callValue: string;
  gasLimit: string;
  ok: boolean;
  gasUsed: number | null;
};

const SAMPLE_LOCAL_CONTRACT =
  "0000000000000000000000000000000000000000000000000000000000000001";

function CopyInline({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Clipboard unavailable in non-secure contexts
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-subtle transition-colors hover:bg-surface-2 hover:text-fg"
      title={label ? `Copy ${label}` : "Copy"}
    >
      {copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/**
 * Interactive Contract Read / Dry-Run Inspector for the Explorer.
 *
 * Executes read-only Wasmi simulations via `/api/contract_call`
 * (`kovanica_call` + `kovanica_estimateGas` + `kovanica_getCode`) without
 * broadcasting a transaction or mutating on-chain state.
 */
export function ContractInspectorPanel({
  source,
  initialContract,
  initialPreset,
  initialFields,
}: ContractInspectorPanelProps) {
  const initialDeepLink = useMemo(() => {
    if (typeof window === "undefined") return null;
    return parseContractInspectorDeepLink(window.location.search);
  }, []);

  const resolvedInitialPreset: ContractPresetId =
    initialPreset ?? initialDeepLink?.presetId ?? "name_resolve";

  const [presetId, setPresetId] = useState<ContractPresetId>(resolvedInitialPreset);
  const [contractAddress, setContractAddress] = useState<string>(
    () =>
      initialContract?.trim() ||
      initialDeepLink?.contractAddress ||
      (source === "local" ? SAMPLE_LOCAL_CONTRACT : ""),
  );
  const [fields, setFields] = useState<Record<string, string>>(() => ({
    ...getContractPreset(resolvedInitialPreset).defaults,
    ...(initialDeepLink?.fields ?? {}),
    ...(initialFields ?? {}),
  }));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [caller, setCaller] = useState("");
  const [callValue, setCallValue] = useState("");
  const [gasLimit, setGasLimit] = useState("");

  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<ContractCallResponse | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [showRpcPayload, setShowRpcPayload] = useState(false);
  const [history, setHistory] = useState<DryRunHistoryItem[]>([]);
  const [copiedAction, setCopiedAction] = useState<"link" | "curl" | "sdk" | null>(null);

  useEffect(() => {
    if (initialContract?.trim()) {
      setContractAddress(initialContract.trim());
    }
  }, [initialContract]);

  useEffect(() => {
    if (initialPreset) {
      setPresetId(initialPreset);
      setFields({
        ...getContractPreset(initialPreset).defaults,
        ...(initialFields ?? {}),
      });
    } else if (initialFields && Object.keys(initialFields).length > 0) {
      setFields((prev) => ({ ...prev, ...initialFields }));
    }
  }, [initialPreset, initialFields]);

  const preset = useMemo(() => getContractPreset(presetId), [presetId]);

  const rpcUrlForSnippets =
    source === "local"
      ? "http://127.0.0.1:8545"
      : "https://testnet.kovanica.online/rpc";

  const shareDeepLink = useMemo(() => {
    const baseUrl =
      typeof window !== "undefined" ? window.location.origin : "https://testnet.kovanica.online";
    return buildContractInspectorDeepLink({
      baseUrl,
      contractAddress,
      presetId,
      fields,
    });
  }, [contractAddress, presetId, fields]);

  const curlSnippet = useMemo(
    () =>
      buildContractCurlSnippet({
        rpcUrl: rpcUrlForSnippets,
        contractAddress,
        presetId,
        fields,
        from: caller,
        value: callValue,
        gas: gasLimit,
      }),
    [rpcUrlForSnippets, contractAddress, presetId, fields, caller, callValue, gasLimit],
  );

  const sdkSnippet = useMemo(
    () =>
      buildContractSdkSnippet({
        rpcUrl: rpcUrlForSnippets,
        contractAddress,
        presetId,
        fields,
        from: caller,
        value: callValue,
        gas: gasLimit,
      }),
    [rpcUrlForSnippets, contractAddress, presetId, fields, caller, callValue, gasLimit],
  );

  function copyDeveloperArtifact(kind: "link" | "curl" | "sdk", text: string) {
    setCopiedAction(kind);
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        setCopiedAction((curr) => (curr === kind ? null : curr));
      }, 1800);
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text).catch(() => {
          // Ignore clipboard write rejection in headless/non-secure environments
        });
      }
    } catch {
      // Clipboard may be restricted in headless/non-secure environments
    }
  }

  const encodedPreview = useMemo(
    () => encodePresetArgs(presetId, fields),
    [presetId, fields],
  );

  const contractCanonical = useMemo(() => {
    const trimmed = contractAddress.trim();
    if (!trimmed) return null;
    return toCanonicalAddress(trimmed);
  }, [contractAddress]);

  const contractValid = contractAddress.trim().length > 0 && contractCanonical !== null;
  const callerValid = !caller.trim() || parseAddr(caller.trim()) !== null;

  const decodedOutput: DecodedContractOutput | null = useMemo(() => {
    if (!response || !response.ok) return null;
    return decodeContractOutput(response.outputHex, response.call.entry);
  }, [response]);

  const parsedError = useMemo(() => {
    if (transportError) {
      return parseContractError(transportError, false);
    }
    if (response && !response.ok) {
      return parseContractError(response.error, response.reverted);
    }
    return null;
  }, [response, transportError]);

  function selectPreset(nextId: ContractPresetId) {
    const next = getContractPreset(nextId);
    setPresetId(nextId);
    setFields({ ...next.defaults });
    setResponse(null);
    setTransportError(null);
  }

  function handleFieldChange(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function handleReset() {
    setFields({ ...preset.defaults });
    setCaller("");
    setCallValue("");
    setGasLimit("");
    setResponse(null);
    setTransportError(null);
  }

  function loadHistoryItem(item: DryRunHistoryItem) {
    setPresetId(item.presetId);
    setContractAddress(item.contractAddress);
    setFields({ ...item.fields });
    setCaller(item.caller);
    setCallValue(item.callValue);
    setGasLimit(item.gasLimit);
    setResponse(null);
    setTransportError(null);
  }

  async function handleExecute(e: React.FormEvent) {
    e.preventDefault();
    if (!contractValid) {
      setTransportError("Enter a valid contract address (kvnc…dag or 32-byte hex).");
      return;
    }
    if (!callerValid) {
      setTransportError("Optional caller (`from`) must be a valid kvnc…dag address or 32-byte hex.");
      return;
    }
    if (!encodedPreview.ok) {
      setTransportError(encodedPreview.error);
      return;
    }

    const payload: ContractCallRequest = {
      to: contractAddress.trim(),
      data: encodedPreview.dataHex,
    };
    if (encodedPreview.entry) payload.entry = encodedPreview.entry;
    if (caller.trim()) payload.from = caller.trim();
    if (callValue.trim()) payload.value = callValue.trim();
    if (gasLimit.trim()) payload.gas = gasLimit.trim();

    setRunning(true);
    setTransportError(null);
    setResponse(null);

    try {
      const res = await apiPostJson<ContractCallResponse>("/api/contract_call", payload);
      setResponse(res);
      setHistory((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: Date.now(),
          presetId,
          contractAddress: contractAddress.trim(),
          entry: res.call.entry ?? "call",
          fields: { ...fields },
          caller: caller.trim(),
          callValue: callValue.trim(),
          gasLimit: gasLimit.trim(),
          ok: res.ok,
          gasUsed: res.ok ? res.gasUsed : null,
        },
        ...prev.slice(0, 4),
      ]);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Contract dry-run request failed";
      setTransportError(msg);
    } finally {
      setRunning(false);
    }
  }

  const canExecute = !running && contractValid && callerValid && encodedPreview.ok;

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Terminal className="size-4 text-gold" />
            <h2 className="font-display text-lg text-fg">Contract Read &amp; Dry-Run Inspector</h2>
            <span className="inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 font-mono text-[10px] font-medium text-gold">
              kovanica_call · read-only
            </span>
          </div>
          <p className="max-w-3xl text-xs text-muted">
            Simulate Wasmi contract entry points against live node state using{" "}
            <code className="font-mono text-fg">kovanica_call</code> and{" "}
            <code className="font-mono text-fg">kovanica_estimateGas</code>. Dry-runs never
            broadcast transactions, require no private key, and do not modify on-chain state.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-subtle">
          <button
            type="button"
            data-testid="copy-share-link-btn"
            onClick={() => void copyDeveloperArtifact("link", shareDeepLink)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg/70 px-2.5 py-1 font-mono text-[11px] text-fg transition-colors hover:border-gold/50 hover:text-gold"
            title="Copy shareable deep-link URL for current contract preset and arguments"
          >
            {copiedAction === "link" ? (
              <>
                <Check className="size-3.5 text-ok" />
                <span>Link Copied</span>
              </>
            ) : (
              <>
                <Link2 className="size-3.5 text-gold" />
                <span>Copy Share Link</span>
              </>
            )}
          </button>
          <button
            type="button"
            data-testid="copy-curl-snippet-btn"
            onClick={() => void copyDeveloperArtifact("curl", curlSnippet)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg/70 px-2.5 py-1 font-mono text-[11px] text-fg transition-colors hover:border-gold/50 hover:text-gold"
            title="Copy ready-to-run JSON-RPC kovanica_call cURL command"
          >
            {copiedAction === "curl" ? (
              <>
                <Check className="size-3.5 text-ok" />
                <span>cURL Copied</span>
              </>
            ) : (
              <>
                <Terminal className="size-3.5 text-gold" />
                <span>Copy JSON-RPC cURL</span>
              </>
            )}
          </button>
          <button
            type="button"
            data-testid="copy-sdk-snippet-btn"
            onClick={() => void copyDeveloperArtifact("sdk", sdkSnippet)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg/70 px-2.5 py-1 font-mono text-[11px] text-fg transition-colors hover:border-gold/50 hover:text-gold"
            title="Copy ready-to-run TypeScript kovanica-sdk snippet"
          >
            {copiedAction === "sdk" ? (
              <>
                <Check className="size-3.5 text-ok" />
                <span>SDK Copied</span>
              </>
            ) : (
              <>
                <Code2 className="size-3.5 text-gold" />
                <span>Copy SDK Snippet</span>
              </>
            )}
          </button>
          <span>target · {source}</span>
        </div>
      </div>

      {/* Main Responsive 2-Column Workspace */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        {/* Left: Call Builder Form */}
        <form
          onSubmit={(e) => void handleExecute(e)}
          className="space-y-4 rounded-lg border border-border bg-surface p-4"
        >
          {/* Preset Picker */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase">
                1. Entry Point Preset
              </span>
              <span className="font-mono text-[10px] text-muted">{preset.category}</span>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Contract presets">
              {CONTRACT_PRESETS.map((p) => {
                const active = p.id === presetId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPreset(p.id)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors",
                      active
                        ? "border-gold/60 bg-gold/15 font-semibold text-gold"
                        : "border-border bg-bg/60 text-muted hover:border-border/80 hover:text-fg",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted">{preset.description}</p>
          </div>

          {/* Contract Address */}
          <div className="space-y-1.5 border-t border-border/60 pt-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="inspector-contract-address"
                className="font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase"
              >
                2. Contract Address (to)
              </label>
              <button
                type="button"
                onClick={() => setContractAddress(SAMPLE_LOCAL_CONTRACT)}
                className="font-mono text-[10px] text-gold hover:underline"
              >
                Fill sample address
              </button>
            </div>
            <input
              id="inspector-contract-address"
              type="text"
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value)}
              placeholder="kvnc…dag or 64-char hex contract address"
              spellCheck={false}
              autoComplete="off"
              className={cn(
                "w-full rounded-md border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-subtle focus:outline-none focus:ring-1",
                contractAddress.trim() && !contractValid
                  ? "border-danger/60 focus:ring-danger"
                  : "border-border focus:border-gold/60 focus:ring-gold/40",
              )}
            />
            {contractAddress.trim() && !contractValid ? (
              <p className="font-mono text-[11px] text-danger">
                Must be a valid canonical kvnc…dag address or 32-byte hex string.
              </p>
            ) : contractCanonical && contractCanonical !== contractAddress.trim().toLowerCase() ? (
              <p className="truncate font-mono text-[10px] text-subtle">
                Canonical: <span className="text-muted">{contractCanonical}</span>
              </p>
            ) : null}
          </div>

          {/* Dynamic Preset Arguments */}
          <div className="space-y-3 border-t border-border/60 pt-3">
            <span className="block font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase">
              3. Call Arguments
            </span>

            {preset.fields.map((field) => {
              const inputId = `inspector-field-${preset.id}-${field.key}`;
              const val = fields[field.key] ?? "";
              return (
                <div key={field.key} className="space-y-1">
                  <label
                    htmlFor={inputId}
                    className="flex items-center justify-between text-xs font-medium text-fg"
                  >
                    <span>
                      {field.label}
                      {field.required ? <span className="ml-0.5 text-gold">*</span> : null}
                    </span>
                    <span className="font-mono text-[10px] text-subtle">{field.kind}</span>
                  </label>
                  {field.kind === "hex" ? (
                    <textarea
                      id={inputId}
                      rows={3}
                      value={val}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      spellCheck={false}
                      className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40"
                    />
                  ) : (
                    <input
                      id={inputId}
                      type="text"
                      value={val}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40"
                    />
                  )}
                  {field.helper ? (
                    <p className="text-[11px] text-subtle">{field.helper}</p>
                  ) : null}
                </div>
              );
            })}

            {/* Live Encoded Payload Preview */}
            <div className="rounded-md border border-border/70 bg-bg/70 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-subtle uppercase">
                  <Code2 className="size-3 text-gold" />
                  Encoded Bincode Payload
                </span>
                {encodedPreview.ok ? (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted">
                      {encodedPreview.byteLength} bytes
                    </span>
                    <CopyInline text={encodedPreview.dataHex} label="Encoded Hex" />
                  </div>
                ) : null}
              </div>
              {encodedPreview.ok ? (
                <p className="mt-1.5 break-all font-mono text-[11px] text-fg select-all">
                  {encodedPreview.dataHex}
                </p>
              ) : (
                <p className="mt-1.5 font-mono text-[11px] text-amber-300">
                  {encodedPreview.error}
                </p>
              )}
            </div>
          </div>

          {/* Optional Execution Overrides */}
          <div className="border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center justify-between text-left font-mono text-[11px] text-muted transition-colors hover:text-fg"
            >
              <span className="inline-flex items-center gap-1.5">
                <SlidersHorizontal className="size-3.5 text-subtle" />
                Optional Execution Overrides (caller, value, gas)
              </span>
              <ChevronDown
                className={cn("size-3.5 transition-transform", showAdvanced && "rotate-180")}
              />
            </button>

            {showAdvanced ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor="inspector-caller" className="text-xs font-medium text-fg">
                    Caller Address (<code className="font-mono text-subtle">from</code>)
                  </label>
                  <input
                    id="inspector-caller"
                    type="text"
                    value={caller}
                    onChange={(e) => setCaller(e.target.value)}
                    placeholder="Defaults to zero address if omitted"
                    spellCheck={false}
                    className={cn(
                      "w-full rounded-md border bg-bg px-3 py-1.5 font-mono text-xs text-fg placeholder:text-subtle focus:outline-none focus:ring-1",
                      caller.trim() && !callerValid
                        ? "border-danger/60 focus:ring-danger"
                        : "border-border focus:border-gold/60 focus:ring-gold/40",
                    )}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="inspector-value" className="text-xs font-medium text-fg">
                    Call Value (atoms)
                  </label>
                  <input
                    id="inspector-value"
                    type="text"
                    value={callValue}
                    onChange={(e) => setCallValue(e.target.value)}
                    placeholder="0 (decimal or 0x hex)"
                    spellCheck={false}
                    className="w-full rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="inspector-gas" className="text-xs font-medium text-fg">
                    Gas Limit
                  </label>
                  <input
                    id="inspector-gas"
                    type="text"
                    value={gasLimit}
                    onChange={(e) => setGasLimit(e.target.value)}
                    placeholder="Node max if omitted"
                    spellCheck={false}
                    className="w-full rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40"
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="h-9 gap-1.5 text-xs"
            >
              <RotateCcw className="size-3.5" />
              <span>Reset</span>
            </Button>

            <Button
              type="submit"
              variant="gold"
              size="sm"
              disabled={!canExecute}
              className="h-9 gap-1.5 px-4 text-xs"
            >
              {running ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <span>Simulating…</span>
                </>
              ) : (
                <>
                  <Play className="size-3.5" />
                  <span>Execute Dry-Run</span>
                </>
              )}
            </Button>
          </div>
        </form>

        {/* Right: Dry-Run Result Inspector */}
        <div
          aria-live="polite"
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase">
              Simulation Result
            </span>
            {response ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold",
                  response.ok
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300",
                )}
              >
                {response.ok ? (
                  <>
                    <CheckCircle2 className="size-3" />
                    Success
                  </>
                ) : (
                  <>
                    <AlertTriangle className="size-3" />
                    Reverted
                  </>
                )}
              </span>
            ) : transportError ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
                <ShieldAlert className="size-3" />
                Error
              </span>
            ) : (
              <span className="font-mono text-[10px] text-subtle">Idle</span>
            )}
          </div>

          {!response && !transportError && !running ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-md border border-dashed border-border/80 bg-bg/40 p-8 text-center">
              <FileCode className="size-8 text-subtle" />
              <p className="mt-3 text-sm font-medium text-fg">Ready to simulate contract call</p>
              <p className="mt-1 max-w-sm text-xs text-muted">
                Choose a preset or enter custom hex call data, specify a contract address, and run
                a read-only dry-run to inspect decoded output, gas usage, or revert diagnostics.
              </p>
            </div>
          ) : null}

          {running ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md border border-border bg-bg/50 p-8 text-center">
              <div className="size-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
              <p className="font-mono text-xs text-muted">
                Running <span className="text-fg">kovanica_call</span> dry-run…
              </p>
            </div>
          ) : null}

          {/* Telemetry Strip */}
          {response ? (
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
              <div className="bg-bg px-3 py-2">
                <dt className="flex items-center gap-1 font-mono text-[9px] tracking-wider text-subtle uppercase">
                  <Fuel className="size-3" />
                  Gas Used
                </dt>
                <dd className="mt-1 font-mono text-xs font-semibold tabular-nums text-fg">
                  {response.ok && response.gasUsed !== null
                    ? response.gasUsed.toLocaleString()
                    : "n/a"}
                </dd>
              </div>
              <div className="bg-bg px-3 py-2">
                <dt className="font-mono text-[9px] tracking-wider text-subtle uppercase">
                  Output Size
                </dt>
                <dd className="mt-1 font-mono text-xs font-semibold tabular-nums text-fg">
                  {decodedOutput ? `${decodedOutput.byteLength} B` : "0 B"}
                </dd>
              </div>
              <div className="bg-bg px-3 py-2">
                <dt className="font-mono text-[9px] tracking-wider text-subtle uppercase">
                  Contract Code
                </dt>
                <dd className="mt-1 font-mono text-xs font-semibold tabular-nums text-fg">
                  {response.codeBytes === null
                    ? "n/a"
                    : response.codeBytes === 0
                      ? "None (EOA)"
                      : `${response.codeBytes.toLocaleString()} B`}
                </dd>
              </div>
              <div className="bg-bg px-3 py-2">
                <dt className="flex items-center gap-1 font-mono text-[9px] tracking-wider text-subtle uppercase">
                  <Clock className="size-3" />
                  Latency
                </dt>
                <dd className="mt-1 font-mono text-xs font-semibold tabular-nums text-fg">
                  {response.latencyMs} ms
                </dd>
              </div>
            </dl>
          ) : null}

          {/* Revert / Error Diagnostic Box */}
          {parsedError ? (
            <div
              className={cn(
                "space-y-2 rounded-md border p-3.5 text-xs",
                parsedError.category === "revert"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                  : "border-danger/30 bg-danger/10 text-danger",
              )}
            >
              <div className="flex items-center gap-2 font-mono font-semibold">
                {parsedError.category === "revert" ? (
                  <AlertTriangle className="size-4 shrink-0 text-amber-400" />
                ) : (
                  <ShieldAlert className="size-4 shrink-0 text-danger" />
                )}
                <span>{parsedError.title}</span>
              </div>
              <p className="break-words font-mono text-[11px] leading-relaxed opacity-90">
                {parsedError.detail}
              </p>
              {response && response.codeBytes === 0 ? (
                <p className="border-t border-current/20 pt-2 text-[11px] opacity-85">
                  Note: <code className="font-mono">kovanica_getCode</code> returned 0 bytes for
                  this address — it may be an externally owned account rather than a deployed Wasmi
                  contract.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Decoded Output Section */}
          {response && response.ok && decodedOutput ? (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-bg/80 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase">
                    Decoded Output ({decodedOutput.primary.kind})
                  </span>
                  {response.codeBytes === 0 ? (
                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                      EOA / No WASM bytecode
                    </span>
                  ) : null}
                </div>

                {decodedOutput.primary.kind === "empty" ? (
                  <p className="font-mono text-xs text-muted">{decodedOutput.primary.summary}</p>
                ) : null}

                {decodedOutput.primary.kind === "name_entry" ? (
                  <div className="space-y-2.5 font-mono text-xs">
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-subtle uppercase">Owner</span>
                      <div className="flex items-center justify-between gap-2">
                        <span className="break-all text-gold">
                          {decodedOutput.primary.value.ownerAddress}
                        </span>
                        <CopyInline
                          text={decodedOutput.primary.value.ownerAddress}
                          label="Owner Address"
                        />
                      </div>
                      <p className="break-all text-[10px] text-subtle">
                        0x{decodedOutput.primary.value.ownerHex}
                      </p>
                    </div>
                    <div className="space-y-0.5 border-t border-border/50 pt-2">
                      <span className="text-[10px] text-subtle uppercase">Comms Pubkey</span>
                      <div className="flex items-center justify-between gap-2">
                        <span className="break-all text-fg">
                          0x{decodedOutput.primary.value.pubkeyHex}
                        </span>
                        <CopyInline
                          text={decodedOutput.primary.value.pubkeyHex}
                          label="Comms Pubkey"
                        />
                      </div>
                    </div>
                    <div className="space-y-1 border-t border-border/50 pt-2">
                      <span className="text-[10px] text-subtle uppercase">
                        Relay Endpoints ({decodedOutput.primary.value.relayEndpoints.length})
                      </span>
                      {decodedOutput.primary.value.relayEndpoints.length === 0 ? (
                        <p className="italic text-subtle">None registered</p>
                      ) : (
                        <ul className="space-y-1">
                          {decodedOutput.primary.value.relayEndpoints.map((ep, idx) => (
                            <li
                              key={idx}
                              className="flex items-center justify-between gap-2 rounded bg-surface px-2 py-1 text-[11px] text-fg"
                            >
                              <span className="break-all">{ep}</span>
                              <CopyInline text={ep} label="Relay Endpoint" />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : null}

                {decodedOutput.primary.kind === "json" ? (
                  <pre className="max-h-56 overflow-auto font-mono text-[11px] text-fg">
                    {decodedOutput.primary.formatted}
                  </pre>
                ) : null}

                {decodedOutput.primary.kind === "bincode_string" ||
                decodedOutput.primary.kind === "utf8" ? (
                  <p className="break-words font-mono text-xs text-fg">
                    {decodedOutput.primary.value}
                  </p>
                ) : null}

                {decodedOutput.primary.kind === "address" ? (
                  <div className="space-y-1 font-mono text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="break-all text-gold">{decodedOutput.primary.canonical}</span>
                      <CopyInline text={decodedOutput.primary.canonical} label="Address" />
                    </div>
                    <p className="break-all text-[10px] text-subtle">
                      0x{decodedOutput.primary.hex}
                    </p>
                  </div>
                ) : null}

                {decodedOutput.primary.kind === "u64" || decodedOutput.primary.kind === "u128" ? (
                  <div className="space-y-1 font-mono text-xs">
                    <p className="text-sm font-semibold text-fg">{decodedOutput.primary.value}</p>
                    <p className="text-[11px] text-subtle">
                      As KVNC (9 decimals):{" "}
                      <span className="text-muted">
                        {formatAtomsDisplay(decodedOutput.primary.value)} KVNC
                      </span>
                    </p>
                  </div>
                ) : null}

                {decodedOutput.primary.kind === "raw" ? (
                  <p className="font-mono text-xs text-muted">
                    Opaque binary return payload ({decodedOutput.primary.byteLength} bytes). Inspect
                    raw hex below.
                  </p>
                ) : null}
              </div>

              {/* Raw Output Hex */}
              <div className="rounded-md border border-border/70 bg-bg/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase">
                    Raw Output Hex
                  </span>
                  <CopyInline text={decodedOutput.rawHex} label="Raw Output Hex" />
                </div>
                <p className="mt-1.5 max-h-36 overflow-auto break-all font-mono text-[11px] text-muted select-all">
                  {decodedOutput.rawHex}
                </p>
              </div>
            </div>
          ) : null}

          {/* Collapsible RPC Call Payload Inspector */}
          {response ? (
            <div className="border-t border-border/60 pt-2">
              <button
                type="button"
                onClick={() => setShowRpcPayload((v) => !v)}
                className="flex items-center gap-1 font-mono text-[10px] text-subtle transition-colors hover:text-fg"
              >
                <ChevronDown
                  className={cn("size-3 transition-transform", !showRpcPayload && "-rotate-90")}
                />
                <span>
                  {showRpcPayload ? "Hide" : "Show"} JSON-RPC Request ({response.rpcMethod})
                </span>
              </button>
              {showRpcPayload ? (
                <pre className="mt-2 max-h-44 overflow-auto rounded border border-border/60 bg-bg/90 p-2.5 font-mono text-[10px] text-muted">
                  {JSON.stringify(
                    {
                      jsonrpc: "2.0",
                      method: response.rpcMethod,
                      params: [response.call],
                      id: 1,
                    },
                    null,
                    2,
                  )}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Session Dry-Run History */}
      {history.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase">
              <History className="size-3.5" />
              Recent Dry-Runs (Session)
            </span>
            <button
              type="button"
              onClick={() => setHistory([])}
              className="font-mono text-[10px] text-subtle hover:text-fg"
            >
              Clear
            </button>
          </div>
          <ul className="divide-y divide-border/50">
            {history.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
              >
                <button
                  type="button"
                  onClick={() => loadHistoryItem(item)}
                  className="flex flex-wrap items-center gap-2 text-left font-mono transition-colors hover:text-gold"
                >
                  <span className="rounded border border-gold/30 bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold">
                    {item.entry}
                  </span>
                  <span className="text-muted">{shortId(item.contractAddress, 8)}</span>
                </button>
                <div className="flex items-center gap-3 font-mono text-[10px]">
                  {item.gasUsed !== null ? (
                    <span className="text-subtle">{item.gasUsed.toLocaleString()} gas</span>
                  ) : null}
                  <span className={item.ok ? "text-emerald-400" : "text-amber-300"}>
                    {item.ok ? "Success" : "Reverted"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
