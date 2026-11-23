import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Code2,
  Copy,
  Database,
  FileCode,
  Fuel,
  History,
  Layers,
  Link2,
  Play,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Terminal,
  Trash2,
} from "lucide-react";
import { ApiError, apiPostJson } from "@/lib/api/client";
import type { ApiSource } from "@/lib/api/contract";
import { Button } from "@/components/ui/button";
import {
  CONTRACT_PRESETS,
  LOCAL_DEMO_PENDING_RECEIPT_TX,
  LOCAL_DEMO_REVERTED_RECEIPT_TX,
  LOCAL_DEMO_SUCCESS_RECEIPT_TX,
  RECEIPT_LOG_PRESETS,
  STORAGE_SLOT_PRESETS,
  buildContractBatchSdkSnippet,
  buildContractCurlSnippet,
  buildContractInspectorDeepLink,
  buildContractSdkSnippet,
  decodeContractOutput,
  decodeContractStorageValue,
  derivePresetStorageSlot,
  encodePresetArgs,
  getContractPreset,
  getReceiptLogPreset,
  getStorageSlotPreset,
  normalizeReceiptTxHash,
  parseContractError,
  parseContractInspectorDeepLink,
  parseContractTransactionReceipt,
  summarizeContractBatchDryRun,
  type ContractBatchQueueItem,
  type ContractCallRequest,
  type ContractCallResponse,
  type ContractPresetId,
  type ContractReceiptResponse,
  type ContractStorageResponse,
  type DecodedContractOutput,
  type DecodedStorageResult,
  type ParsedContractTransactionReceipt,
  type ReceiptLogPresetId,
  type StorageSlotPresetId,
} from "@/lib/contracts/dry-run";
import { formatAtomsDisplay } from "@/lib/contracts/decoders";
import {
  decodeWireTxAutoHex,
  type DecodeWireTxAutoResult,
} from "@/lib/explorer/raw-tx-decode";
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
  const [copiedAction, setCopiedAction] = useState<"link" | "curl" | "sdk" | "batch_sdk" | null>(
    null,
  );

  // Multi-Call Batch Dry-Run Queue state
  const [batchQueue, setBatchQueue] = useState<ContractBatchQueueItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);

  // Storage Slot & Bincode State Reader state
  const [storagePresetId, setStoragePresetId] = useState<StorageSlotPresetId>("name");
  const [storageKeyInput, setStorageKeyInput] = useState<string>(
    () => getStorageSlotPreset("name").defaultInput,
  );
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageResponse, setStorageResponse] = useState<ContractStorageResponse | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  // Transaction Receipt & Emitted Log Bincode Inspector state
  const [receiptTxHash, setReceiptTxHash] = useState<string>(LOCAL_DEMO_SUCCESS_RECEIPT_TX);
  const [receiptLogPresetId, setReceiptLogPresetId] = useState<ReceiptLogPresetId>("auto");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptResponse, setReceiptResponse] = useState<ContractReceiptResponse | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  // Offline Raw Wire Tx Decoder state (collapsed by default)
  const [rawTxOpen, setRawTxOpen] = useState(false);
  const [rawTxHexInput, setRawTxHexInput] = useState("");
  const [rawTxResult, setRawTxResult] = useState<DecodeWireTxAutoResult | null>(null);

  function handleDecodeRawTx() {
    setRawTxResult(decodeWireTxAutoHex(rawTxHexInput));
  }

  function handleClearRawTx() {
    setRawTxHexInput("");
    setRawTxResult(null);
  }

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

  const batchSummary = useMemo(
    () => summarizeContractBatchDryRun(batchQueue),
    [batchQueue],
  );

  const batchSdkSnippet = useMemo(
    () =>
      buildContractBatchSdkSnippet({
        rpcUrl: rpcUrlForSnippets,
        items: batchQueue,
        sender: caller.trim() || undefined,
        chainId: 2,
      }),
    [rpcUrlForSnippets, batchQueue, caller],
  );

  function copyDeveloperArtifact(kind: "link" | "curl" | "sdk" | "batch_sdk", text: string) {
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
  const canQueueBatchCall = !batchRunning && contractValid && callerValid && encodedPreview.ok;

  function handleQueueCallToBatch() {
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

    const newItem: ContractBatchQueueItem = {
      id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      presetId,
      contractAddress: contractAddress.trim(),
      entry: encodedPreview.entry || preset.entry || "call",
      fields: { ...fields },
      dataHex: encodedPreview.dataHex,
      byteLength: encodedPreview.byteLength,
      from: caller.trim() || undefined,
      value: callValue.trim() || undefined,
      gas: gasLimit.trim() || undefined,
      response: null,
      transportError: null,
    };

    setBatchQueue((prev) => [...prev, newItem]);
  }

  function handleRemoveBatchItem(id: string) {
    setBatchQueue((prev) => prev.filter((item) => item.id !== id));
  }

  function handleClearBatch() {
    setBatchQueue([]);
  }

  async function handleRunBatchDryRun() {
    if (batchQueue.length === 0 || batchRunning) return;
    setBatchRunning(true);

    const snapshot = [...batchQueue];
    for (const item of snapshot) {
      const payload: ContractCallRequest = {
        to: item.contractAddress,
        data: item.dataHex,
      };
      if (item.entry) payload.entry = item.entry;
      if (item.from) payload.from = item.from;
      if (item.value) payload.value = item.value;
      if (item.gas) payload.gas = item.gas;

      try {
        const res = await apiPostJson<ContractCallResponse>("/api/contract_call", payload);
        setBatchQueue((prev) =>
          prev.map((curr) =>
            curr.id === item.id ? { ...curr, response: res, transportError: null } : curr,
          ),
        );
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Batch dry-run call failed";
        setBatchQueue((prev) =>
          prev.map((curr) =>
            curr.id === item.id ? { ...curr, response: null, transportError: msg } : curr,
          ),
        );
      }
    }

    setBatchRunning(false);
  }

  const storagePreset = useMemo(
    () => getStorageSlotPreset(storagePresetId),
    [storagePresetId],
  );
  const derivedStorageSlot = useMemo(
    () => derivePresetStorageSlot(storagePresetId, storageKeyInput),
    [storagePresetId, storageKeyInput],
  );
  const decodedStorage: DecodedStorageResult | null = useMemo(() => {
    if (!storageResponse) return null;
    return decodeContractStorageValue(
      storageResponse.storageHex,
      storageResponse.query.schemaHint,
    );
  }, [storageResponse]);

  function selectStoragePreset(nextId: StorageSlotPresetId) {
    const next = getStorageSlotPreset(nextId);
    setStoragePresetId(nextId);
    setStorageKeyInput(next.defaultInput);
    setStorageResponse(null);
    setStorageError(null);
  }

  async function handleReadStorage(e: React.FormEvent) {
    e.preventDefault();
    if (!contractValid) {
      setStorageError("Enter a valid contract address (kvnc…dag or 32-byte hex).");
      return;
    }
    if (!derivedStorageSlot.ok) {
      setStorageError(derivedStorageSlot.error);
      return;
    }

    setStorageLoading(true);
    setStorageError(null);
    setStorageResponse(null);

    try {
      const res = await apiPostJson<ContractStorageResponse>("/api/contract_storage", {
        contract: contractAddress.trim(),
        slot: derivedStorageSlot.slotHex,
        key: derivedStorageSlot.rawKey ?? undefined,
        schemaHint: storagePreset.schemaHint,
      });
      setStorageResponse(res);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Contract storage read failed";
      setStorageError(msg);
    } finally {
      setStorageLoading(false);
    }
  }

  const canReadStorage = !storageLoading && contractValid && derivedStorageSlot.ok;

  const receiptLogPreset = useMemo(
    () => getReceiptLogPreset(receiptLogPresetId),
    [receiptLogPresetId],
  );
  const normalizedReceiptHash = useMemo(
    () => normalizeReceiptTxHash(receiptTxHash),
    [receiptTxHash],
  );
  const parsedReceipt: ParsedContractTransactionReceipt | null = useMemo(() => {
    if (!receiptResponse || !receiptResponse.found || !receiptResponse.receipt) return null;
    return parseContractTransactionReceipt(receiptResponse.receipt, receiptLogPresetId);
  }, [receiptResponse, receiptLogPresetId]);

  const canInspectReceipt = !receiptLoading && normalizedReceiptHash.ok;

  function selectDemoReceiptTx(txHash: string) {
    setReceiptTxHash(txHash);
    setReceiptResponse(null);
    setReceiptError(null);
  }

  async function handleInspectReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!normalizedReceiptHash.ok) {
      setReceiptError(normalizedReceiptHash.error);
      return;
    }

    setReceiptLoading(true);
    setReceiptError(null);
    setReceiptResponse(null);

    try {
      const res = await apiPostJson<ContractReceiptResponse>("/api/contract_receipt", {
        txHash: normalizedReceiptHash.txHash,
        presetId: receiptLogPresetId,
      });
      setReceiptResponse(res);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Transaction receipt inspection failed";
      setReceiptError(msg);
    } finally {
      setReceiptLoading(false);
    }
  }

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

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="queue-batch-call-btn"
                disabled={!canQueueBatchCall}
                onClick={handleQueueCallToBatch}
                className="h-9 gap-1.5 text-xs"
              >
                <Plus className="size-3.5 text-gold" />
                <span>Queue Call to Batch ({batchQueue.length})</span>
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

      {/* Multi-Call Batch Dry-Run Queue & Batch SDK Exporter */}
      <section
        aria-label="Multi-Call Batch Dry-Run Simulator"
        data-testid="batch-dry-run-section"
        className="space-y-4 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Layers className="size-4 text-gold" />
              <h3 className="font-display text-base text-fg">
                Multi-Call Batch Dry-Run Queue &amp; Batch SDK Exporter
              </h3>
              <span className="inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 font-mono text-[10px] font-medium text-gold">
                estimateBatchCalls · {batchSummary.totalCalls}{" "}
                {batchSummary.totalCalls === 1 ? "call" : "calls"}
              </span>
            </div>
            <p className="max-w-3xl text-xs text-muted">
              Queue multiple contract calls, simulate the entire batch sequentially via{" "}
              <code className="font-mono text-fg">POST /api/contract_call</code>, inspect aggregate
              pass/revert/gas metrics, and export a ready-to-run TypeScript{" "}
              <code className="font-mono text-fg">estimateBatchCalls</code> SDK snippet.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="gold"
              size="sm"
              data-testid="run-batch-dry-run-btn"
              disabled={batchQueue.length === 0 || batchRunning}
              onClick={() => void handleRunBatchDryRun()}
              className="h-8 gap-1.5 px-3 text-xs"
            >
              {batchRunning ? (
                <>
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <span>Running Batch…</span>
                </>
              ) : (
                <>
                  <Play className="size-3.5" />
                  <span>Run Batch Dry-Run</span>
                </>
              )}
            </Button>

            <button
              type="button"
              data-testid="copy-batch-sdk-btn"
              disabled={batchQueue.length === 0}
              onClick={() => copyDeveloperArtifact("batch_sdk", batchSdkSnippet)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-bg/70 px-2.5 font-mono text-[11px] text-fg transition-colors hover:border-gold/50 hover:text-gold disabled:pointer-events-none disabled:opacity-45"
              title="Copy ready-to-run TypeScript kovanica-sdk estimateBatchCalls snippet"
            >
              {copiedAction === "batch_sdk" ? (
                <>
                  <Check className="size-3.5 text-ok" />
                  <span>Batch SDK Copied</span>
                </>
              ) : (
                <>
                  <Code2 className="size-3.5 text-gold" />
                  <span>Copy Batch SDK Snippet</span>
                </>
              )}
            </button>

            <button
              type="button"
              data-testid="clear-batch-btn"
              disabled={batchQueue.length === 0 || batchRunning}
              onClick={handleClearBatch}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-bg/70 px-2.5 font-mono text-[11px] text-subtle transition-colors hover:border-danger/50 hover:text-danger disabled:pointer-events-none disabled:opacity-45"
            >
              <Trash2 className="size-3.5" />
              <span>Clear Batch</span>
            </button>
          </div>
        </div>

        {/* Aggregate Batch Telemetry Strip */}
        <dl
          data-testid="batch-dry-run-summary"
          className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-5"
        >
          <div className="bg-bg px-3 py-2">
            <dt className="font-mono text-[9px] tracking-wider text-subtle uppercase">
              Total Calls
            </dt>
            <dd
              data-testid="batch-total-calls"
              className="mt-1 font-mono text-xs font-semibold tabular-nums text-fg"
            >
              {batchSummary.totalCalls}
            </dd>
          </div>
          <div className="bg-bg px-3 py-2">
            <dt className="font-mono text-[9px] tracking-wider text-subtle uppercase">Passed</dt>
            <dd
              data-testid="batch-passed-calls"
              className="mt-1 font-mono text-xs font-semibold tabular-nums text-emerald-400"
            >
              {batchSummary.passedCalls}
            </dd>
          </div>
          <div className="bg-bg px-3 py-2">
            <dt className="font-mono text-[9px] tracking-wider text-subtle uppercase">Reverted</dt>
            <dd
              data-testid="batch-reverted-calls"
              className="mt-1 font-mono text-xs font-semibold tabular-nums text-amber-300"
            >
              {batchSummary.revertedCalls + batchSummary.errorCalls}
            </dd>
          </div>
          <div className="bg-bg px-3 py-2">
            <dt className="flex items-center gap-1 font-mono text-[9px] tracking-wider text-subtle uppercase">
              <Fuel className="size-3" />
              Total Gas Used
            </dt>
            <dd
              data-testid="batch-total-gas"
              className="mt-1 font-mono text-xs font-semibold tabular-nums text-fg"
            >
              {batchSummary.totalGasUsed.toLocaleString()}
            </dd>
          </div>
          <div className="bg-bg px-3 py-2">
            <dt className="flex items-center gap-1 font-mono text-[9px] tracking-wider text-subtle uppercase">
              <Clock className="size-3" />
              Total Latency
            </dt>
            <dd
              data-testid="batch-total-latency"
              className="mt-1 font-mono text-xs font-semibold tabular-nums text-fg"
            >
              {batchSummary.totalLatencyMs} ms
            </dd>
          </div>
        </dl>

        {batchSummary.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border/70 bg-bg/40 p-6 text-center">
            <Layers className="size-6 text-subtle" />
            <p className="mt-2 text-xs font-medium text-fg">Batch queue is empty</p>
            <p className="mt-1 max-w-md text-[11px] text-muted">
              Configure a contract call above and click{" "}
              <span className="font-mono text-fg">Queue Call to Batch</span> to build a multi-call
              simulation sequence.
            </p>
          </div>
        ) : (
          <ul data-testid="batch-queue-list" className="divide-y divide-border/60 rounded-md border border-border bg-bg/60">
            {batchSummary.items.map((item) => (
              <li
                key={item.id}
                data-testid={`batch-queue-item-${item.index}`}
                className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 font-mono">
                    <span className="text-[10px] text-subtle">#{item.index}</span>
                    <span className="rounded border border-gold/30 bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                      {item.entry}
                    </span>
                    <span className="text-[11px] text-muted">
                      {shortId(item.contractAddress, 8)}
                    </span>
                    <span className="text-[10px] text-subtle">{item.byteLength} B</span>
                  </div>
                  <p className="truncate font-mono text-[11px] text-fg">{item.outputSummary}</p>
                </div>

                <div className="flex items-center gap-2.5 font-mono text-[10px]">
                  {item.gasUsed !== null ? (
                    <span className="text-subtle">{item.gasUsed.toLocaleString()} gas</span>
                  ) : null}
                  {item.latencyMs !== null ? (
                    <span className="text-subtle">{item.latencyMs} ms</span>
                  ) : null}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold",
                      item.status === "passed"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : item.status === "reverted" || item.status === "error"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                          : "border-border bg-surface text-muted",
                    )}
                  >
                    {item.status === "passed"
                      ? "Passed"
                      : item.status === "reverted"
                        ? "Reverted"
                        : item.status === "error"
                          ? "Error"
                          : "Queued"}
                  </span>
                  <button
                    type="button"
                    disabled={batchRunning}
                    onClick={() => handleRemoveBatchItem(item.id)}
                    className="rounded p-1 text-subtle transition-colors hover:bg-surface hover:text-danger disabled:opacity-40"
                    title={`Remove call #${item.index} from batch`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

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

      {/* Contract Storage Slot & Bincode State Reader */}
      <section
        aria-label="Contract Storage Slot and Bincode State Reader"
        data-testid="contract-storage-reader"
        className="space-y-4 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Database className="size-4 text-gold" />
              <h3 className="font-display text-base text-fg">
                Contract Storage Slot &amp; Bincode State Reader
              </h3>
              <span className="inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 font-mono text-[10px] font-medium text-gold">
                kovanica_getStorageAt · BLAKE3 slot
              </span>
            </div>
            <p className="max-w-3xl text-xs text-muted">
              Derive canonical BLAKE3 storage slots (<code className="font-mono text-fg">name:</code>
              , <code className="font-mono text-fg">token:meta</code>,{" "}
              <code className="font-mono text-fg">escrow:</code>,{" "}
              <code className="font-mono text-fg">htlc:</code>,{" "}
              <code className="font-mono text-fg">vault:</code>,{" "}
              <code className="font-mono text-fg">multisig:state</code>) or query any raw 32-byte
              hex slot via <code className="font-mono text-fg">kovanica_getStorageAt</code> and
              decode on-chain Bincode records.
            </p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          {/* Left: Storage Slot Query Form */}
          <form onSubmit={(e) => void handleReadStorage(e)} className="space-y-3.5">
            <div className="space-y-2">
              <span className="font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase">
                1. Storage Key Convention
              </span>
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label="Contract storage slot presets"
              >
                {STORAGE_SLOT_PRESETS.map((sp) => {
                  const active = sp.id === storagePresetId;
                  return (
                    <button
                      key={sp.id}
                      type="button"
                      data-testid={`storage-preset-${sp.id}`}
                      onClick={() => selectStoragePreset(sp.id)}
                      aria-pressed={active}
                      className={cn(
                        "rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors",
                        active
                          ? "border-gold/60 bg-gold/15 font-semibold text-gold"
                          : "border-border bg-bg/60 text-muted hover:border-border/80 hover:text-fg",
                      )}
                    >
                      {sp.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted">{storagePreset.description}</p>
            </div>

            {!storagePreset.fixedKey ? (
              <div className="space-y-1">
                <label
                  htmlFor="inspector-storage-key-input"
                  className="flex items-center justify-between text-xs font-medium text-fg"
                >
                  <span>
                    {storagePreset.prefix
                      ? `Key Identifier (prefixed with "${storagePreset.prefix}")`
                      : "Raw Storage Key or 32-Byte Hex Slot"}
                  </span>
                  <span className="font-mono text-[10px] text-subtle">
                    {storagePreset.prefix ? `${storagePreset.prefix}<id>` : "utf8 / hex32"}
                  </span>
                </label>
                <input
                  id="inspector-storage-key-input"
                  data-testid="storage-key-input"
                  type="text"
                  value={storageKeyInput}
                  onChange={(e) => setStorageKeyInput(e.target.value)}
                  placeholder={storagePreset.placeholder}
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40"
                />
              </div>
            ) : null}

            {/* Live Derived Slot Preview */}
            <div className="rounded-md border border-border/70 bg-bg/70 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-subtle uppercase">
                  <Code2 className="size-3 text-gold" />
                  Derived 32-Byte Storage Slot
                </span>
                {derivedStorageSlot.ok ? (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted">
                      {derivedStorageSlot.derivation === "blake3" && derivedStorageSlot.rawKey
                        ? `blake3("${derivedStorageSlot.rawKey}")`
                        : "raw 32-byte slot"}
                    </span>
                    <CopyInline text={derivedStorageSlot.slotHex} label="Storage Slot Hex" />
                  </div>
                ) : null}
              </div>
              {derivedStorageSlot.ok ? (
                <p
                  data-testid="derived-storage-slot-hex"
                  className="mt-1.5 break-all font-mono text-[11px] text-fg select-all"
                >
                  {derivedStorageSlot.slotHex}
                </p>
              ) : (
                <p className="mt-1.5 font-mono text-[11px] text-amber-300">
                  {derivedStorageSlot.error}
                </p>
              )}
            </div>

            <div className="flex justify-end pt-1">
              <Button
                type="submit"
                variant="gold"
                size="sm"
                data-testid="read-storage-slot-btn"
                disabled={!canReadStorage}
                className="h-9 gap-1.5 px-4 text-xs"
              >
                {storageLoading ? (
                  <>
                    <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <span>Reading Slot…</span>
                  </>
                ) : (
                  <>
                    <Search className="size-3.5" />
                    <span>Read Storage Slot</span>
                  </>
                )}
              </Button>
            </div>
          </form>

          {/* Right: Storage Value & Decoded Bincode Record */}
          <div
            aria-live="polite"
            data-testid="storage-reader-result"
            className="flex flex-col gap-3 rounded-md border border-border bg-bg/50 p-3.5"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase">
                Storage Slot State
              </span>
              {storageResponse && decodedStorage ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold",
                    decodedStorage.isEmpty
                      ? "border-border bg-surface text-muted"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                  )}
                >
                  {decodedStorage.isEmpty
                    ? "Empty Slot"
                    : `Decoded (${decodedStorage.record.kind})`}
                </span>
              ) : storageError ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
                  Error
                </span>
              ) : (
                <span className="font-mono text-[10px] text-subtle">Idle</span>
              )}
            </div>

            {!storageResponse && !storageError && !storageLoading ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded border border-dashed border-border/70 bg-bg/40 p-6 text-center">
                <Database className="size-7 text-subtle" />
                <p className="mt-2 text-xs font-medium text-fg">
                  Ready to read on-chain storage slot
                </p>
                <p className="mt-1 max-w-xs text-[11px] text-muted">
                  Select a key convention or enter a 32-byte slot hex and click Read Storage Slot
                  to inspect raw storage bytes and decoded Bincode state.
                </p>
              </div>
            ) : null}

            {storageError ? (
              <div className="rounded border border-danger/30 bg-danger/10 p-3 font-mono text-xs text-danger">
                {storageError}
              </div>
            ) : null}

            {storageResponse && decodedStorage ? (
              <div className="space-y-3 font-mono text-xs">
                {/* Decoded Record Fields */}
                <div className="rounded border border-border bg-bg/90 p-3">
                  <div className="mb-2 flex items-center justify-between text-[10px] text-subtle uppercase">
                    <span>Bincode Record ({decodedStorage.record.kind})</span>
                    <span>
                      {decodedStorage.byteLength} B · {storageResponse.latencyMs} ms
                    </span>
                  </div>

                  {decodedStorage.record.kind === "empty" ? (
                    <p className="text-xs text-muted">{decodedStorage.record.summary}</p>
                  ) : null}

                  {decodedStorage.record.kind === "name_entry" ? (
                    <div className="space-y-2">
                      <div>
                        <span className="text-[10px] text-subtle uppercase">Owner</span>
                        <div className="flex items-center justify-between gap-2">
                          <span className="break-all text-gold">
                            {decodedStorage.record.value.ownerAddress}
                          </span>
                          <CopyInline
                            text={decodedStorage.record.value.ownerAddress}
                            label="Owner Address"
                          />
                        </div>
                      </div>
                      <div className="border-t border-border/50 pt-1.5">
                        <span className="text-[10px] text-subtle uppercase">Comms Pubkey</span>
                        <p className="break-all text-fg">
                          0x{decodedStorage.record.value.pubkeyHex}
                        </p>
                      </div>
                      <div className="border-t border-border/50 pt-1.5">
                        <span className="text-[10px] text-subtle uppercase">
                          Relay Endpoints ({decodedStorage.record.value.relayEndpoints.length})
                        </span>
                        <ul className="mt-1 space-y-1">
                          {decodedStorage.record.value.relayEndpoints.map((ep, idx) => (
                            <li
                              key={idx}
                              className="rounded bg-surface px-2 py-1 text-[11px] text-fg"
                            >
                              {ep}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}

                  {decodedStorage.record.kind === "token_meta" ? (
                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-[10px] text-subtle uppercase">Name / Symbol</dt>
                        <dd className="font-semibold text-fg">
                          {decodedStorage.record.value.name} ({decodedStorage.record.value.symbol})
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] text-subtle uppercase">Decimals / Status</dt>
                        <dd className="text-fg">
                          {decodedStorage.record.value.decimals} dec ·{" "}
                          {decodedStorage.record.value.paused ? "Paused" : "Active"}
                        </dd>
                      </div>
                      <div className="col-span-2 border-t border-border/50 pt-1.5">
                        <dt className="text-[10px] text-subtle uppercase">Total Supply (base units)</dt>
                        <dd className="text-gold">{decodedStorage.record.value.totalSupply}</dd>
                      </div>
                      <div className="col-span-2 border-t border-border/50 pt-1.5">
                        <dt className="text-[10px] text-subtle uppercase">Owner</dt>
                        <dd className="break-all text-fg">
                          {decodedStorage.record.value.ownerAddress}
                        </dd>
                      </div>
                    </dl>
                  ) : null}

                  {decodedStorage.record.kind === "escrow" ? (
                    <div className="space-y-1.5">
                      <p>
                        <span className="text-subtle">Threshold:</span>{" "}
                        <span className="text-fg">
                          {decodedStorage.record.value.threshold} of{" "}
                          {decodedStorage.record.value.partiesAddresses.length}
                        </span>
                      </p>
                      <p>
                        <span className="text-subtle">Amount:</span>{" "}
                        <span className="text-gold">
                          {formatAtomsDisplay(decodedStorage.record.value.amount)} KVNC
                        </span>{" "}
                        ({decodedStorage.record.value.amount} atoms)
                      </p>
                      <p>
                        <span className="text-subtle">Deadline:</span>{" "}
                        <span className="text-fg">{decodedStorage.record.value.deadline}</span>
                      </p>
                    </div>
                  ) : null}

                  {decodedStorage.record.kind === "htlc" ? (
                    <div className="space-y-1.5">
                      <p className="break-all">
                        <span className="text-subtle">Hashlock:</span>{" "}
                        <span className="text-fg">0x{decodedStorage.record.value.hashlockHex}</span>
                      </p>
                      <p className="break-all">
                        <span className="text-subtle">Recipient:</span>{" "}
                        <span className="text-gold">
                          {decodedStorage.record.value.recipientAddress}
                        </span>
                      </p>
                      <p>
                        <span className="text-subtle">Timelock:</span>{" "}
                        <span className="text-fg">{decodedStorage.record.value.timelock}</span>
                      </p>
                    </div>
                  ) : null}

                  {decodedStorage.record.kind === "vault" ? (
                    <div className="space-y-1.5">
                      <p className="break-all">
                        <span className="text-subtle">Owner:</span>{" "}
                        <span className="text-gold">
                          {decodedStorage.record.value.ownerAddress}
                        </span>
                      </p>
                      <p>
                        <span className="text-subtle">Lock Until:</span>{" "}
                        <span className="text-fg">{decodedStorage.record.value.lockUntil}</span>
                      </p>
                      {decodedStorage.record.value.amount ? (
                        <p>
                          <span className="text-subtle">Locked Amount:</span>{" "}
                          <span className="text-fg">
                            {formatAtomsDisplay(decodedStorage.record.value.amount)} KVNC
                          </span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {decodedStorage.record.kind === "multisig" ? (
                    <div className="space-y-1.5">
                      <p>
                        <span className="text-subtle">Threshold:</span>{" "}
                        <span className="text-gold">
                          {decodedStorage.record.value.threshold} of{" "}
                          {decodedStorage.record.value.ownersAddresses.length} signers
                        </span>
                      </p>
                      <ul className="space-y-1 text-[11px] text-fg">
                        {decodedStorage.record.value.ownersAddresses.map((addr, idx) => (
                          <li key={idx} className="break-all rounded bg-surface px-2 py-1">
                            {addr}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {decodedStorage.record.kind === "address" ? (
                    <p className="break-all text-gold">{decodedStorage.record.canonical}</p>
                  ) : null}

                  {decodedStorage.record.kind === "u64" ||
                  decodedStorage.record.kind === "u128" ||
                  decodedStorage.record.kind === "utf8" ? (
                    <p className="break-all text-fg">{decodedStorage.record.value}</p>
                  ) : null}

                  {decodedStorage.record.kind === "raw" ? (
                    <p className="text-muted">
                      Opaque binary storage value ({decodedStorage.byteLength} bytes).
                    </p>
                  ) : null}
                </div>

                {/* Raw Storage Hex */}
                <div className="rounded border border-border/70 bg-bg/70 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold tracking-wider text-subtle uppercase">
                      Raw Storage Hex (kovanica_getStorageAt)
                    </span>
                    <CopyInline text={decodedStorage.rawHex} label="Raw Storage Hex" />
                  </div>
                  <p
                    data-testid="raw-storage-hex"
                    className="mt-1 max-h-28 overflow-auto break-all text-[11px] text-muted select-all"
                  >
                    {decodedStorage.rawHex}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Transaction Receipt & Event Log Bincode Decoder */}
      <section
        aria-label="Transaction Receipt and Event Log Bincode Decoder"
        data-testid="receipt-log-inspector-section"
        className="space-y-4 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <FileCode className="size-4 text-gold" />
              <h3 className="font-display text-base text-fg">
                Transaction Receipt &amp; Event Log Bincode Decoder
              </h3>
              <span className="inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 font-mono text-[10px] font-medium text-gold">
                kovanica_getTransactionReceipt · Bincode logs
              </span>
            </div>
            <p className="max-w-3xl text-xs text-muted">
              Query any 32-byte transaction hash via{" "}
              <code className="font-mono text-fg">kovanica_getTransactionReceipt</code> to inspect
              execution status (<code className="font-mono text-fg">success</code> /{" "}
              <code className="font-mono text-fg">reverted</code>), gas used, block hash, and decode
              emitted Wasmi Bincode event logs (<code className="font-mono text-fg">NameEntry</code>
              , <code className="font-mono text-fg">TokenMetadata</code>,{" "}
              <code className="font-mono text-fg">Escrow</code>,{" "}
              <code className="font-mono text-fg">HTLC</code>,{" "}
              <code className="font-mono text-fg">Vault</code>,{" "}
              <code className="font-mono text-fg">Multisig</code>).
            </p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          {/* Left: Receipt Query & Log Decoder Preset Form */}
          <form onSubmit={(e) => void handleInspectReceipt(e)} className="space-y-3.5">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="inspector-receipt-tx-hash"
                  className="font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase"
                >
                  1. Transaction Hash (32-Byte Hex)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="receipt-preset-demo-success"
                    onClick={() => selectDemoReceiptTx(LOCAL_DEMO_SUCCESS_RECEIPT_TX)}
                    className="font-mono text-[10px] text-gold hover:underline"
                  >
                    Local Demo Success Receipt
                  </button>
                  <span className="text-subtle">·</span>
                  <button
                    type="button"
                    data-testid="receipt-preset-demo-reverted"
                    onClick={() => selectDemoReceiptTx(LOCAL_DEMO_REVERTED_RECEIPT_TX)}
                    className="font-mono text-[10px] text-amber-300 hover:underline"
                  >
                    Reverted Receipt
                  </button>
                  <span className="text-subtle">·</span>
                  <button
                    type="button"
                    data-testid="receipt-preset-demo-pending"
                    onClick={() => selectDemoReceiptTx(LOCAL_DEMO_PENDING_RECEIPT_TX)}
                    className="font-mono text-[10px] text-muted hover:underline"
                  >
                    Pending Receipt
                  </button>
                </div>
              </div>

              <input
                id="inspector-receipt-tx-hash"
                data-testid="receipt-tx-hash-input"
                type="text"
                value={receiptTxHash}
                onChange={(e) => setReceiptTxHash(e.target.value)}
                placeholder="0x… (64 hex characters)"
                spellCheck={false}
                autoComplete="off"
                className={cn(
                  "w-full rounded-md border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-subtle focus:outline-none focus:ring-1",
                  receiptTxHash.trim() && !normalizedReceiptHash.ok
                    ? "border-danger/60 focus:ring-danger"
                    : "border-border focus:border-gold/60 focus:ring-gold/40",
                )}
              />
              {receiptTxHash.trim() && !normalizedReceiptHash.ok ? (
                <p className="font-mono text-[11px] text-danger">{normalizedReceiptHash.error}</p>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-border/60 pt-3">
              <span className="font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase">
                2. Emitted Log Bincode Decoder Preset
              </span>
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label="Receipt log decoder presets"
              >
                {RECEIPT_LOG_PRESETS.map((lp) => {
                  const active = lp.id === receiptLogPresetId;
                  return (
                    <button
                      key={lp.id}
                      type="button"
                      data-testid={`receipt-log-preset-${lp.id}`}
                      onClick={() => setReceiptLogPresetId(lp.id)}
                      aria-pressed={active}
                      className={cn(
                        "rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors",
                        active
                          ? "border-gold/60 bg-gold/15 font-semibold text-gold"
                          : "border-border bg-bg/60 text-muted hover:border-border/80 hover:text-fg",
                      )}
                    >
                      {lp.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted">{receiptLogPreset.description}</p>
            </div>

            <div className="flex justify-end pt-1">
              <Button
                type="submit"
                variant="gold"
                size="sm"
                data-testid="inspect-receipt-btn"
                disabled={!canInspectReceipt}
                className="h-9 gap-1.5 px-4 text-xs"
              >
                {receiptLoading ? (
                  <>
                    <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <span>Inspecting Receipt…</span>
                  </>
                ) : (
                  <>
                    <Search className="size-3.5" />
                    <span>Inspect Receipt &amp; Decode Logs</span>
                  </>
                )}
              </Button>
            </div>
          </form>

          {/* Right: Receipt Summary Strip & Decoded Bincode Log Cards */}
          <div
            aria-live="polite"
            data-testid="receipt-inspector-result"
            className="flex flex-col gap-3 rounded-md border border-border bg-bg/50 p-3.5"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase">
                Receipt &amp; Decoded Event Logs
              </span>
              {parsedReceipt ? (
                <span
                  data-testid="receipt-status-badge"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold",
                    parsedReceipt.status === "success"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-300",
                  )}
                >
                  {parsedReceipt.status === "success" ? (
                    <>
                      <CheckCircle2 className="size-3" />
                      Success (0x1)
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="size-3" />
                      Reverted (0x0)
                    </>
                  )}
                </span>
              ) : receiptResponse && !receiptResponse.found ? (
                <span
                  data-testid="receipt-status-badge"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[10px] font-semibold text-muted"
                >
                  Pending / Not Found
                </span>
              ) : receiptError ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
                  Error
                </span>
              ) : (
                <span className="font-mono text-[10px] text-subtle">Idle</span>
              )}
            </div>

            {!receiptResponse && !receiptError && !receiptLoading ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded border border-dashed border-border/70 bg-bg/40 p-6 text-center">
                <FileCode className="size-7 text-subtle" />
                <p className="mt-2 text-xs font-medium text-fg">
                  Ready to inspect transaction receipt
                </p>
                <p className="mt-1 max-w-xs text-[11px] text-muted">
                  Enter a 32-byte transaction hash or choose a demo preset and click Inspect Receipt
                  &amp; Decode Logs to decode emitted Wasmi Bincode logs.
                </p>
              </div>
            ) : null}

            {receiptError ? (
              <div className="rounded border border-danger/30 bg-danger/10 p-3 font-mono text-xs text-danger">
                {receiptError}
              </div>
            ) : null}

            {receiptResponse && !receiptResponse.found ? (
              <div className="rounded border border-border bg-bg/80 p-3.5 font-mono text-xs text-muted">
                No receipt found for{" "}
                <span className="text-fg">{shortId(receiptResponse.query.txHash, 10)}</span> (
                <code className="text-fg">null</code> — transaction is pending in mempool or unknown).
              </div>
            ) : null}

            {parsedReceipt ? (
              <div className="space-y-3 font-mono text-xs">
                {/* Receipt Summary Strip: Status, Gas Used, Block Hash, Logs Count */}
                <dl
                  data-testid="receipt-summary-strip"
                  className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4"
                >
                  <div className="bg-bg px-3 py-2">
                    <dt className="font-mono text-[9px] tracking-wider text-subtle uppercase">
                      Status
                    </dt>
                    <dd
                      data-testid="receipt-summary-status"
                      className={cn(
                        "mt-1 font-mono text-xs font-semibold",
                        parsedReceipt.status === "success"
                          ? "text-emerald-400"
                          : "text-amber-300",
                      )}
                    >
                      {parsedReceipt.status === "success" ? "Success" : "Reverted"}
                    </dd>
                  </div>
                  <div className="bg-bg px-3 py-2">
                    <dt className="flex items-center gap-1 font-mono text-[9px] tracking-wider text-subtle uppercase">
                      <Fuel className="size-3" />
                      Gas Used
                    </dt>
                    <dd
                      data-testid="receipt-summary-gas"
                      className="mt-1 font-mono text-xs font-semibold tabular-nums text-fg"
                    >
                      {parsedReceipt.gasUsed !== null
                        ? parsedReceipt.gasUsed.toLocaleString()
                        : "n/a"}
                    </dd>
                  </div>
                  <div className="bg-bg px-3 py-2">
                    <dt className="font-mono text-[9px] tracking-wider text-subtle uppercase">
                      Block Hash
                    </dt>
                    <dd
                      data-testid="receipt-summary-block"
                      className="mt-1 truncate font-mono text-xs font-semibold text-fg"
                      title={parsedReceipt.blockHash ?? undefined}
                    >
                      {parsedReceipt.blockHash ? shortId(parsedReceipt.blockHash, 8) : "n/a"}
                    </dd>
                  </div>
                  <div className="bg-bg px-3 py-2">
                    <dt className="font-mono text-[9px] tracking-wider text-subtle uppercase">
                      Logs Count
                    </dt>
                    <dd
                      data-testid="receipt-summary-logs-count"
                      className="mt-1 font-mono text-xs font-semibold tabular-nums text-gold"
                    >
                      {parsedReceipt.logsCount}
                    </dd>
                  </div>
                </dl>

                {parsedReceipt.revertReason ? (
                  <div
                    data-testid="receipt-revert-reason"
                    className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                      <AlertTriangle className="size-3.5" />
                      <span>Revert Reason</span>
                    </div>
                    <p className="mt-1 break-words text-[11px]">{parsedReceipt.revertReason}</p>
                  </div>
                ) : null}

                {/* Emitted Bincode Log Cards */}
                {parsedReceipt.logs.length === 0 ? (
                  <div className="rounded border border-border/70 bg-bg/70 p-3 text-center text-xs text-muted">
                    No event logs emitted in this transaction receipt.
                  </div>
                ) : (
                  <div data-testid="receipt-decoded-logs-list" className="space-y-2.5">
                    {parsedReceipt.logs.map((log) => (
                      <div
                        key={log.index}
                        data-testid={`receipt-log-card-${log.index}`}
                        className="space-y-2 rounded-md border border-border bg-bg/90 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded border border-gold/30 bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                              Log #{log.index}
                            </span>
                            <span className="text-[10px] font-semibold text-fg uppercase">
                              {log.decoded.record.kind}
                            </span>
                            <span className="text-[10px] text-subtle">{log.byteLength} B</span>
                          </div>
                          {log.address ? (
                            <span className="text-[10px] text-muted" title={log.address}>
                              {shortId(log.address, 8)}
                            </span>
                          ) : null}
                        </div>

                        {log.topics.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-subtle">
                            <span>Topics:</span>
                            {log.topics.map((topic, tIdx) => (
                              <span
                                key={tIdx}
                                className="rounded bg-surface px-1.5 py-0.5 text-muted"
                              >
                                {topic.length > 24 ? shortId(topic, 8) : topic}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {/* Decoded Bincode Log Record */}
                        {log.decoded.record.kind === "name_entry" ? (
                          <div className="space-y-1.5 text-xs">
                            <div>
                              <span className="text-[10px] text-subtle uppercase">Owner</span>
                              <div className="flex items-center justify-between gap-2">
                                <span className="break-all text-gold">
                                  {log.decoded.record.value.ownerAddress}
                                </span>
                                <CopyInline
                                  text={log.decoded.record.value.ownerAddress}
                                  label="Owner Address"
                                />
                              </div>
                            </div>
                            <div>
                              <span className="text-[10px] text-subtle uppercase">
                                Relay Endpoints ({log.decoded.record.value.relayEndpoints.length})
                              </span>
                              <ul className="mt-1 space-y-1">
                                {log.decoded.record.value.relayEndpoints.map((ep, epIdx) => (
                                  <li
                                    key={epIdx}
                                    className="rounded bg-surface px-2 py-1 text-[11px] text-fg"
                                  >
                                    {ep}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        ) : null}

                        {log.decoded.record.kind === "token_meta" ? (
                          <dl className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <dt className="text-[10px] text-subtle uppercase">Name / Symbol</dt>
                              <dd className="font-semibold text-fg">
                                {log.decoded.record.value.name} ({log.decoded.record.value.symbol})
                              </dd>
                            </div>
                            <div>
                              <dt className="text-[10px] text-subtle uppercase">
                                Decimals / Status
                              </dt>
                              <dd className="text-fg">
                                {log.decoded.record.value.decimals} dec ·{" "}
                                {log.decoded.record.value.paused ? "Paused" : "Active"}
                              </dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-[10px] text-subtle uppercase">
                                Total Supply (base units)
                              </dt>
                              <dd className="text-gold">{log.decoded.record.value.totalSupply}</dd>
                            </div>
                          </dl>
                        ) : null}

                        {log.decoded.record.kind === "escrow" ||
                        log.decoded.record.kind === "htlc" ||
                        log.decoded.record.kind === "vault" ||
                        log.decoded.record.kind === "multisig" ||
                        log.decoded.record.kind === "address" ||
                        log.decoded.record.kind === "u64" ||
                        log.decoded.record.kind === "u128" ||
                        log.decoded.record.kind === "utf8" ||
                        log.decoded.record.kind === "raw" ||
                        log.decoded.record.kind === "empty" ? (
                          <p className="break-words text-xs text-fg">{log.decoded.summary}</p>
                        ) : null}

                        <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-1.5">
                          <span className="truncate text-[10px] text-subtle">
                            Data: {log.dataHex}
                          </span>
                          <CopyInline text={log.dataHex} label={`Log #${log.index} Hex`} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Collapsible Offline Raw Wire Tx Decoder */}
      <section
        aria-label="Decode Raw Wire Tx"
        data-testid="raw-tx-decoder-panel"
        className="rounded-lg border border-border bg-surface"
      >
        <button
          type="button"
          onClick={() => setRawTxOpen((prev) => !prev)}
          aria-expanded={rawTxOpen}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/40"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Code2 className="size-4 text-gold" />
            <h3 className="font-display text-base text-fg">Decode Raw Wire Tx</h3>
            <span className="inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 font-mono text-[10px] font-medium text-gold">
              offline · Bincode 1.x Transfer + Call
            </span>
          </div>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted transition-transform",
              rawTxOpen && "rotate-180",
            )}
          />
        </button>

        {rawTxOpen ? (
          <div className="space-y-4 border-t border-border/60 p-4">
            <p className="max-w-3xl text-xs text-muted">
              Paste a hex-encoded signed Bincode 1.x{" "}
              <code className="font-mono text-fg">Transfer</code> or{" "}
              <code className="font-mono text-fg">Call</code> transaction (bare or{" "}
              <code className="font-mono text-fg">0x</code>-prefixed, up to 256 KiB) to inspect
              sender, nonce, recipient/amount or contract/gas/call arguments, fee, and signature
              completely offline without sending any network request.
            </p>

            <div className="space-y-2">
              <label
                htmlFor="inspector-raw-tx-hex"
                className="block font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase"
              >
                Raw Bincode Wire Transaction Hex
              </label>
              <textarea
                id="inspector-raw-tx-hex"
                data-testid="raw-tx-hex-input"
                rows={3}
                value={rawTxHexInput}
                onChange={(e) => setRawTxHexInput(e.target.value)}
                placeholder="0x… or bare hex Bincode wire Transfer or Call transaction"
                spellCheck={false}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40"
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                {rawTxHexInput || rawTxResult ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleClearRawTx}
                    className="h-8 gap-1.5 px-3 text-xs"
                  >
                    <RotateCcw className="size-3" />
                    <span>Clear</span>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="gold"
                  size="sm"
                  data-testid="raw-tx-decode-btn"
                  onClick={handleDecodeRawTx}
                  className="h-8 gap-1.5 px-4 text-xs"
                >
                  <Terminal className="size-3.5" />
                  <span>Decode Offline</span>
                </Button>
              </div>
            </div>

            <div aria-live="polite">
              {rawTxResult && !rawTxResult.ok ? (
                <div
                  role="alert"
                  data-testid="raw-tx-decode-error"
                  className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 font-mono text-xs text-danger"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{rawTxResult.error}</span>
                </div>
              ) : null}

              {rawTxResult && rawTxResult.ok && rawTxResult.kind === "transfer" ? (
                <div
                  data-testid="raw-tx-decode-result"
                  className="space-y-3 rounded-md border border-border bg-bg/60 p-3.5 font-mono text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        data-testid="raw-tx-kind-badge"
                        className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-400"
                      >
                        Transfer
                      </span>
                      <span className="text-[10px] text-subtle">
                        variant 0 · canonical {rawTxResult.tx.wireSizeBytes} B wire tx
                      </span>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
                    <div className="bg-bg px-3 py-2">
                      <dt className="text-[9px] tracking-wider text-subtle uppercase">Nonce</dt>
                      <dd className="mt-1 font-semibold tabular-nums text-fg">
                        {rawTxResult.tx.nonce.toString()}
                      </dd>
                    </div>
                    <div className="bg-bg px-3 py-2">
                      <dt className="text-[9px] tracking-wider text-subtle uppercase">Amount</dt>
                      <dd
                        className="mt-1 font-semibold tabular-nums text-emerald-400"
                        title={`${rawTxResult.tx.amountAtoms.toString()} atoms`}
                      >
                        {formatAtomsDisplay(rawTxResult.tx.amountAtoms)} KVNC
                      </dd>
                    </div>
                    <div className="bg-bg px-3 py-2">
                      <dt className="text-[9px] tracking-wider text-subtle uppercase">Fee</dt>
                      <dd
                        className="mt-1 font-semibold tabular-nums text-gold"
                        title={`${rawTxResult.tx.feeAtoms.toString()} atoms`}
                      >
                        {formatAtomsDisplay(rawTxResult.tx.feeAtoms)} KVNC
                      </dd>
                    </div>
                    <div className="bg-bg px-3 py-2">
                      <dt className="text-[9px] tracking-wider text-subtle uppercase">Wire Size</dt>
                      <dd className="mt-1 font-semibold tabular-nums text-fg">
                        {rawTxResult.tx.wireSizeBytes.toLocaleString()} B
                      </dd>
                    </div>
                  </dl>

                  <div className="space-y-2 rounded border border-border/70 bg-bg/80 p-3">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-subtle uppercase">Sender</span>
                        <CopyInline text={rawTxResult.tx.senderAddress} label="Sender Address" />
                      </div>
                      <p className="break-all text-gold">{rawTxResult.tx.senderAddress}</p>
                      <p className="break-all text-[10px] text-subtle">
                        0x{rawTxResult.tx.senderHex}
                      </p>
                    </div>

                    <div className="border-t border-border/50 pt-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-subtle uppercase">Recipient</span>
                        <CopyInline
                          text={rawTxResult.tx.recipientAddress}
                          label="Recipient Address"
                        />
                      </div>
                      <p className="break-all text-fg">{rawTxResult.tx.recipientAddress}</p>
                      <p className="break-all text-[10px] text-subtle">
                        0x{rawTxResult.tx.recipientHex}
                      </p>
                    </div>

                    <div className="border-t border-border/50 pt-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-subtle uppercase">Wire Hash (32 B)</span>
                        <CopyInline
                          text={`0x${rawTxResult.tx.wireHashHex}`}
                          label="Wire Hash Hex"
                        />
                      </div>
                      <p className="mt-1 break-all text-[11px] text-muted select-all">
                        0x{rawTxResult.tx.wireHashHex}
                      </p>
                    </div>

                    <div className="border-t border-border/50 pt-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-subtle uppercase">
                          Ed25519 Signature (64 B)
                        </span>
                        <CopyInline
                          text={`0x${rawTxResult.tx.signatureHex}`}
                          label="Signature Hex"
                        />
                      </div>
                      <p className="mt-1 break-all text-[10px] text-subtle">
                        0x{rawTxResult.tx.signatureHex}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {rawTxResult && rawTxResult.ok && rawTxResult.kind === "call" ? (
                <div
                  data-testid="raw-tx-decode-result"
                  className="space-y-3 rounded-md border border-border bg-bg/60 p-3.5 font-mono text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        data-testid="raw-tx-kind-badge"
                        className="inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-gold"
                      >
                        Call
                      </span>
                      <span className="text-[10px] text-subtle">
                        variant 6 · Wasmi contract call
                      </span>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
                    <div className="bg-bg px-3 py-2">
                      <dt className="text-[9px] tracking-wider text-subtle uppercase">Nonce</dt>
                      <dd className="mt-1 font-semibold tabular-nums text-fg">
                        {rawTxResult.tx.nonce.toString()}
                      </dd>
                    </div>
                    <div className="bg-bg px-3 py-2">
                      <dt className="text-[9px] tracking-wider text-subtle uppercase">Fee</dt>
                      <dd
                        className="mt-1 font-semibold tabular-nums text-gold"
                        title={`${rawTxResult.tx.fee.toString()} atoms`}
                      >
                        {formatAtomsDisplay(rawTxResult.tx.fee)} KVNC
                      </dd>
                    </div>
                    <div className="bg-bg px-3 py-2">
                      <dt className="flex items-center gap-1 text-[9px] tracking-wider text-subtle uppercase">
                        <Fuel className="size-3" />
                        Gas Limit
                      </dt>
                      <dd className="mt-1 font-semibold tabular-nums text-fg">
                        {rawTxResult.tx.gasLimit.toLocaleString()}
                      </dd>
                    </div>
                    <div className="bg-bg px-3 py-2">
                      <dt className="text-[9px] tracking-wider text-subtle uppercase">Wire Size</dt>
                      <dd className="mt-1 font-semibold tabular-nums text-fg">
                        {rawTxResult.tx.wireSizeBytes.toLocaleString()} B
                      </dd>
                    </div>
                  </dl>

                  <div className="space-y-2 rounded border border-border/70 bg-bg/80 p-3">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-subtle uppercase">Sender</span>
                        <CopyInline text={rawTxResult.tx.senderAddress} label="Sender Address" />
                      </div>
                      <p className="break-all text-gold">{rawTxResult.tx.senderAddress}</p>
                      <p className="break-all text-[10px] text-subtle">
                        0x{rawTxResult.tx.senderHex}
                      </p>
                    </div>

                    <div className="border-t border-border/50 pt-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-subtle uppercase">Contract</span>
                        <CopyInline
                          text={rawTxResult.tx.contractAddress}
                          label="Contract Address"
                        />
                      </div>
                      <p className="break-all text-fg">{rawTxResult.tx.contractAddress}</p>
                      <p className="break-all text-[10px] text-subtle">
                        0x{rawTxResult.tx.contractHex}
                      </p>
                    </div>

                    <div className="border-t border-border/50 pt-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] text-subtle uppercase">
                            Call Args ({rawTxResult.tx.argsLength} B)
                          </span>
                          {rawTxResult.tx.decodedCallArgs ? (
                            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                              {rawTxResult.tx.decodedCallArgs.method}
                            </span>
                          ) : null}
                        </div>
                        {rawTxResult.tx.argsHex ? (
                          <CopyInline text={`0x${rawTxResult.tx.argsHex}`} label="Call Args Hex" />
                        ) : null}
                      </div>
                      <p className="mt-1 max-h-24 overflow-auto break-all text-[11px] text-muted select-all">
                        {rawTxResult.tx.argsHex ? `0x${rawTxResult.tx.argsHex}` : "(empty)"}
                      </p>
                    </div>

                    <div className="border-t border-border/50 pt-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-subtle uppercase">
                          Ed25519 Signature (64 B)
                        </span>
                        <CopyInline
                          text={`0x${rawTxResult.tx.signatureHex}`}
                          label="Signature Hex"
                        />
                      </div>
                      <p className="mt-1 break-all text-[10px] text-subtle">
                        0x{rawTxResult.tx.signatureHex}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
