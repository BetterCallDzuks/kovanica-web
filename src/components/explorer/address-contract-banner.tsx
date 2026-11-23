/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { getApiSource } from "@/lib/api/client";
import { CONTRACT_PRESETS, type ContractPresetId } from "@/lib/contracts/dry-run";
import { inspectExplorerAddress } from "@/lib/explorer/address-inspect";
import {
  filterTimelineEntries,
  normalizeTimelineLogs,
  type ContractTimelineEntry,
  type RawTimelineLog,
} from "@/lib/explorer/log-timeline";
import { cn } from "@/lib/utils";
import { toCanonicalAddress } from "@/lib/wallet/address";

export type ContractAccountInfo = {
  /** Inspected account or contract address (`kvnc…dag` or 32-byte hex). */
  address?: string | null;
  /** Deployed WASM bytecode length in bytes returned by `kovanica_getCode`. */
  codeBytes?: number | null;
  /** Optional raw hex bytecode string returned by `kovanica_getCode`. */
  codeHex?: string | null;
  /** Explicit flag when contract status is already confirmed. */
  isContract?: boolean | null;
  /** Optional set/list of known deployed contract addresses (canonical or hex). */
  knownContracts?: readonly string[] | ReadonlySet<string>;
  /** Optional human-readable label for the detected contract. */
  label?: string | null;
};

function parseHexByteLength(codeHex: string | null | undefined): number | null {
  if (typeof codeHex !== "string") return null;
  const trimmed = codeHex.trim();
  if (!trimmed || trimmed === "0x" || trimmed === "0X") return 0;
  const clean = trimmed.replace(/^0[xX]/, "");
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    return null;
  }
  return clean.length / 2;
}

/**
 * Resolve the deployed bytecode size in bytes from a `ContractAccountInfo`
 * payload, returning `null` if unknown.
 */
export function resolveContractCodeBytes(
  info: ContractAccountInfo | null | undefined,
): number | null {
  if (!info) return null;
  if (typeof info.codeBytes === "number" && Number.isFinite(info.codeBytes) && info.codeBytes >= 0) {
    return Math.floor(info.codeBytes);
  }
  return parseHexByteLength(info.codeHex);
}

/**
 * Determine whether an inspected account/address is a deployed WASM contract.
 *
 * Truthful precedence:
 * 1. If `codeBytes` (or `codeHex`) is explicitly reported as `> 0`, returns `true`.
 * 2. If `codeBytes` is explicitly reported as `0`, returns `false`.
 * 3. If `isContract === true`, returns `true`.
 * 4. If `address` matches an entry in `knownContracts` (comparing canonical `kvnc…dag`),
 *    returns `true`.
 */
export function isDeployedContractAccount(
  info: ContractAccountInfo | null | undefined,
): boolean {
  if (!info) return false;

  const resolvedBytes = resolveContractCodeBytes(info);
  if (resolvedBytes !== null) {
    return resolvedBytes > 0;
  }

  if (info.isContract === true) {
    return true;
  }

  if (info.address && info.knownContracts) {
    const canonicalTarget = toCanonicalAddress(info.address);
    if (!canonicalTarget) return false;
    const entries =
      info.knownContracts instanceof Set
        ? Array.from(info.knownContracts)
        : Array.isArray(info.knownContracts)
          ? info.knownContracts
          : [];
    for (const candidate of entries) {
      if (typeof candidate !== "string") continue;
      if (toCanonicalAddress(candidate) === canonicalTarget) {
        return true;
      }
    }
  }

  return false;
}

function isValidPreset(preset: string | null | undefined): preset is ContractPresetId {
  if (!preset) return false;
  return CONTRACT_PRESETS.some((p) => p.id === preset);
}

/**
 * Build a canonical Explorer Contract Inspector deep-link URL:
 * `/explorer?tab=contracts&contract=<canonical-addr>[&preset=<preset>]`
 */
export function buildContractInspectorUrl(
  contractAddress: string,
  preset?: ContractPresetId | null,
): string {
  const params = new URLSearchParams();
  params.set("tab", "contracts");

  const trimmed = contractAddress.trim();
  const canonical = trimmed ? toCanonicalAddress(trimmed) : null;
  if (canonical) {
    params.set("contract", canonical);
  } else if (trimmed) {
    params.set("contract", trimmed);
  }

  if (isValidPreset(preset)) {
    params.set("preset", preset);
  }

  return `/explorer?${params.toString()}`;
}

const DEFAULT_TESTNET_RPC_URL = "https://rpc-testnet.kovanica.online/rpc";
const DEFAULT_LOCAL_RPC_URL = "http://127.0.0.1:8545/rpc";
const RECENT_LOG_WINDOW_BLOCKS = 400;

function resolveExplorerRpcUrl(explicitRpcUrl?: string | null): string {
  const trimmed = typeof explicitRpcUrl === "string" ? explicitRpcUrl.trim() : "";
  if (trimmed) return trimmed;
  return getApiSource() === "local" ? DEFAULT_LOCAL_RPC_URL : DEFAULT_TESTNET_RPC_URL;
}

async function jsonRpcRequest<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (payload.error) {
    throw new Error(payload.error.message || `RPC error calling ${method}`);
  }
  return payload.result as T;
}

async function fetchRecentContractLogs(
  canonicalAddress: string,
  explicitRpcUrl?: string | null,
): Promise<RawTimelineLog[]> {
  const rpcUrl = resolveExplorerRpcUrl(explicitRpcUrl);
  const filter: Record<string, unknown> = { address: canonicalAddress };

  try {
    const latestHex = await jsonRpcRequest<unknown>(rpcUrl, "kovanica_blockNumber", []);
    if (typeof latestHex === "string" && /^0[xX][0-9a-fA-F]+$/.test(latestHex.trim())) {
      const latest = BigInt(latestHex.trim());
      const from = latest > BigInt(RECENT_LOG_WINDOW_BLOCKS)
        ? latest - BigInt(RECENT_LOG_WINDOW_BLOCKS)
        : 0n;
      filter.fromBlock = `0x${from.toString(16)}`;
      filter.toBlock = `0x${latest.toString(16)}`;
    }
  } catch {
    // Fall back to an address-only filter if `kovanica_blockNumber` is unavailable.
  }

  const result = await jsonRpcRequest<unknown>(rpcUrl, "kovanica_getLogs", [filter]);
  return Array.isArray(result) ? (result as RawTimelineLog[]) : [];
}

function formatCompactHex(hex: string, maxChars = 48): string {
  if (hex.length <= maxChars) return hex;
  return `${hex.slice(0, maxChars - 1)}…`;
}

export type AddressContractBannerProps = {
  /** Searched or inspected address (`kvnc…dag` or 32-byte hex). */
  address: string | null | undefined;
  /** Deployed WASM bytecode length in bytes (from `kovanica_getCode`). */
  codeBytes?: number | null;
  /** Optional raw hex bytecode string. */
  codeHex?: string | null;
  /** Explicit override when contract status is already confirmed. */
  isContract?: boolean | null;
  /** Optional list/set of known deployed contract addresses. */
  knownContracts?: readonly string[] | ReadonlySet<string>;
  /** Optional preset to pre-select when opening Contract Inspector. */
  preset?: ContractPresetId | null;
  /** Optional human-readable label for the detected contract. */
  label?: string | null;
  /** Optional click handler to switch tabs in-place without full reload. */
  onOpenInspector?: (canonicalAddress: string, preset?: ContractPresetId) => void;
  /** Optional RPC URL override for `kovanica_getLogs` timeline fetches. */
  rpcUrl?: string | null;
  /** Optional custom log fetcher for testing or host-provided RPC routing. */
  fetchLogs?: (canonicalAddress: string) => Promise<RawTimelineLog[]>;
  className?: string;
};

/**
 * Auto-detection banner surfaced in the Explorer when a searched or inspected
 * address has deployed WASM contract bytecode, offering a one-click deep-link
 * straight into the Contract Inspector tab plus a collapsible Recent Contract
 * Events timeline.
 */
export function AddressContractBanner({
  address,
  codeBytes,
  codeHex,
  isContract,
  knownContracts,
  preset,
  label,
  onOpenInspector,
  rpcUrl,
  fetchLogs,
  className,
}: AddressContractBannerProps) {
  const trimmed = typeof address === "string" ? address.trim() : "";
  const canonicalAddress = trimmed ? (toCanonicalAddress(trimmed) ?? trimmed) : "";

  const [timelineOpen, setTimelineOpen] = useState(false);
  const [checksumOpen, setChecksumOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<"mainnet" | "testnet" | "payload" | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [entries, setEntries] = useState<ContractTimelineEntry[]>([]);
  const [hasLoadedLogs, setHasLoadedLogs] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  const inspection = useMemo(() => inspectExplorerAddress(trimmed), [trimmed]);

  useEffect(() => {
    setTimelineOpen(false);
    setChecksumOpen(false);
    setCopiedField(null);
    setFilterQuery("");
    setEntries([]);
    setHasLoadedLogs(false);
    setLoadingLogs(false);
    setLogsError(null);
  }, [canonicalAddress]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  function handleCopyField(field: "mainnet" | "testnet" | "payload", value: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(value).catch(() => {
        // Ignore clipboard write rejection in non-secure/headless environments
      });
    }
    setCopiedField(field);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopiedField((current) => (current === field ? null : current));
    }, 1500);
  }

  const filteredEntries = useMemo(
    () => filterTimelineEntries(entries, filterQuery),
    [entries, filterQuery],
  );

  if (
    !trimmed ||
    !isDeployedContractAccount({
      address: trimmed,
      codeBytes,
      codeHex,
      isContract,
      knownContracts,
      label,
    })
  ) {
    return null;
  }

  const resolvedBytes = resolveContractCodeBytes({ codeBytes, codeHex });
  const inspectorHref = buildContractInspectorUrl(canonicalAddress, preset);

  function handleOpenClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      !onOpenInspector ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    onOpenInspector(canonicalAddress, isValidPreset(preset) ? preset : undefined);
  }

  async function handleLoadRecentLogs() {
    if (!canonicalAddress || loadingLogs) return;
    setLoadingLogs(true);
    setLogsError(null);
    try {
      const rawLogs = fetchLogs
        ? await fetchLogs(canonicalAddress)
        : await fetchRecentContractLogs(canonicalAddress, rpcUrl);
      setEntries(normalizeTimelineLogs(rawLogs));
      setHasLoadedLogs(true);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : "Failed to load contract logs");
    } finally {
      setLoadingLogs(false);
    }
  }

  return (
    <div
      data-testid="address-contract-banner"
      role="region"
      aria-label="Deployed WASM Contract Detected"
      className={cn(
        "border-b border-gold/35 bg-gold/10 px-4 py-3 text-xs md:px-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-gold/40 bg-gold/15 text-gold">
            <FileCode className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-fg">Deployed WASM Contract Detected</span>
              {label ? (
                <span className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  {label}
                </span>
              ) : null}
              <span
                data-testid="address-contract-code-bytes"
                className="inline-flex items-center rounded-full border border-gold/30 bg-bg/70 px-2 py-0.5 font-mono text-[11px] font-medium text-gold tabular-nums"
              >
                {resolvedBytes !== null && resolvedBytes > 0
                  ? `${resolvedBytes.toLocaleString("en-US")} bytes`
                  : "WASM bytecode"}
              </span>
            </div>
            <p
              data-testid="address-contract-canonical"
              className="break-all font-mono text-[11px] text-muted"
            >
              {canonicalAddress}
            </p>
          </div>
        </div>

        <a
          href={inspectorHref}
          onClick={handleOpenClick}
          data-testid="open-in-contract-inspector-btn"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-gold/45 bg-gold/20 px-3 font-medium text-fg transition-colors hover:bg-gold/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          <span>Open in Contract Inspector</span>
          <ArrowUpRight className="size-3.5 text-gold" aria-hidden="true" />
        </a>
      </div>

      {/* Collapsible PRO-21 Checksum & Raw Payload Inspector (collapsed by default) */}
      <div
        data-testid="address-checksum-inspector"
        className="mt-2.5 border-t border-gold/25 pt-2"
      >
        <button
          type="button"
          onClick={() => setChecksumOpen((open) => !open)}
          aria-expanded={checksumOpen}
          data-testid="address-checksum-inspector-toggle"
          className="inline-flex flex-wrap items-center gap-1.5 rounded px-1 py-0.5 text-[11px] font-medium text-fg/90 transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          {checksumOpen ? (
            <ChevronDown className="size-3.5 text-gold" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5 text-gold" aria-hidden="true" />
          )}
          {inspection.checksumValid ? (
            <ShieldCheck className="size-3.5 text-emerald-400" aria-hidden="true" />
          ) : (
            <ShieldAlert className="size-3.5 text-amber-400" aria-hidden="true" />
          )}
          <span>PRO-21 Checksum &amp; Raw Payload</span>
          <span
            data-testid="address-checksum-status"
            className={cn(
              "rounded-full border px-1.5 py-0.2 font-mono text-[10px]",
              inspection.checksumValid
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                : inspection.valid
                  ? "border-amber-500/35 bg-amber-500/10 text-amber-300"
                  : "border-danger/35 bg-danger/10 text-danger",
            )}
          >
            {inspection.checksumValid
              ? "Checksum Verified"
              : inspection.valid
                ? "Legacy Hex (Unchecked)"
                : "Invalid Checksum"}
          </span>
        </button>

        {checksumOpen ? (
          <div
            data-testid="address-checksum-inspector-body"
            className="mt-2 space-y-2 rounded-lg border border-border/80 bg-bg/80 p-2.5"
          >
            {inspection.valid ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
                  <span className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-fg">
                    {inspection.format}
                  </span>
                  <span>
                    {inspection.checksumValid
                      ? "29-bit BLAKE3 checksum verified against 32-byte payload."
                      : "Decoded from raw 32-byte hex (no embedded PRO-21 checksum)."}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {inspection.canonicalMainnet ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-surface/70 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <div className="text-[10px] font-medium text-muted">
                          Canonical Mainnet (kvnc…dag)
                        </div>
                        <code
                          data-testid="inspector-canonical-mainnet"
                          className="block break-all font-mono text-[11px] text-fg"
                        >
                          {inspection.canonicalMainnet}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyField("mainnet", inspection.canonicalMainnet!)
                        }
                        data-testid="copy-canonical-mainnet-btn"
                        aria-label="Copy canonical mainnet address"
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border bg-bg px-2 text-[10px] font-medium text-fg transition-colors hover:border-gold/50 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
                      >
                        {copiedField === "mainnet" ? (
                          <>
                            <Check className="size-3 text-emerald-400" aria-hidden="true" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" aria-hidden="true" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : null}

                  {inspection.canonicalTestnet ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-surface/70 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <div className="text-[10px] font-medium text-muted">
                          Canonical Testnet (tknc…dag)
                        </div>
                        <code
                          data-testid="inspector-canonical-testnet"
                          className="block break-all font-mono text-[11px] text-fg"
                        >
                          {inspection.canonicalTestnet}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyField("testnet", inspection.canonicalTestnet!)
                        }
                        data-testid="copy-canonical-testnet-btn"
                        aria-label="Copy canonical testnet address"
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border bg-bg px-2 text-[10px] font-medium text-fg transition-colors hover:border-gold/50 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
                      >
                        {copiedField === "testnet" ? (
                          <>
                            <Check className="size-3 text-emerald-400" aria-hidden="true" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" aria-hidden="true" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : null}

                  {inspection.payloadHex ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-surface/70 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <div className="text-[10px] font-medium text-muted">
                          Raw 32-Byte Payload (0x…)
                        </div>
                        <code
                          data-testid="inspector-payload-hex"
                          className="block break-all font-mono text-[11px] text-fg"
                        >
                          {inspection.payloadHex}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyField("payload", inspection.payloadHex!)}
                        data-testid="copy-payload-hex-btn"
                        aria-label="Copy raw 32-byte payload hex"
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border bg-bg px-2 text-[10px] font-medium text-fg transition-colors hover:border-gold/50 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
                      >
                        {copiedField === "payload" ? (
                          <>
                            <Check className="size-3 text-emerald-400" aria-hidden="true" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" aria-hidden="true" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <p
                role="alert"
                data-testid="address-checksum-inspector-error"
                className="rounded border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger"
              >
                {inspection.error ?? "Invalid address format"}
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* Collapsible Recent Contract Events Timeline (collapsed by default) */}
      <div
        data-testid="contract-log-timeline"
        className="mt-2.5 border-t border-gold/25 pt-2"
      >
        <button
          type="button"
          onClick={() => setTimelineOpen((open) => !open)}
          aria-expanded={timelineOpen}
          data-testid="contract-log-timeline-toggle"
          className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] font-medium text-fg/90 transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          {timelineOpen ? (
            <ChevronDown className="size-3.5 text-gold" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5 text-gold" aria-hidden="true" />
          )}
          <ScrollText className="size-3.5 text-gold" aria-hidden="true" />
          <span>Recent Contract Events</span>
          {hasLoadedLogs ? (
            <span className="rounded-full border border-gold/30 bg-bg/70 px-1.5 py-0.2 font-mono text-[10px] text-muted tabular-nums">
              {entries.length}
            </span>
          ) : null}
        </button>

        {timelineOpen ? (
          <div className="mt-2 space-y-2 rounded-lg border border-border/80 bg-bg/80 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(event) => setFilterQuery(event.target.value)}
                  placeholder="Filter by topic, tx hash, or decoded text…"
                  aria-label="Filter contract events"
                  data-testid="contract-log-filter-input"
                  className="h-7 w-full rounded-md border border-border bg-surface pl-8 pr-2.5 text-[11px] text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleLoadRecentLogs()}
                disabled={loadingLogs}
                data-testid="load-recent-logs-btn"
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-gold/40 bg-gold/15 px-2.5 text-[11px] font-medium text-fg transition-colors hover:bg-gold/25 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
              >
                <RefreshCw
                  className={cn("size-3 text-gold", loadingLogs && "animate-spin")}
                  aria-hidden="true"
                />
                <span>{loadingLogs ? "Loading…" : "Load Recent Logs"}</span>
              </button>
            </div>

            {logsError ? (
              <p
                role="alert"
                data-testid="contract-log-timeline-error"
                className="rounded border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger"
              >
                {logsError}
              </p>
            ) : null}

            {!hasLoadedLogs && !loadingLogs && !logsError ? (
              <p className="px-1 py-1 text-[11px] text-muted">
                Click <span className="font-medium text-fg">Load Recent Logs</span> to query recent
                emitted events via <code className="font-mono">kovanica_getLogs</code>.
              </p>
            ) : null}

            {hasLoadedLogs && filteredEntries.length === 0 ? (
              <p className="px-1 py-1 text-[11px] text-muted">
                {entries.length === 0
                  ? "No recent contract events found in the scanned block window."
                  : "No contract events match the current filter."}
              </p>
            ) : null}

            {filteredEntries.length > 0 ? (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
                {filteredEntries.map((entry, idx) => (
                  <li
                    key={`${entry.blockNumber}-${entry.logIndex}-${entry.txHash || idx}`}
                    data-testid="contract-log-timeline-item"
                    className="rounded-md border border-border/70 bg-surface/70 px-2.5 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] font-medium text-fg tabular-nums">
                          #{entry.blockNumber.toLocaleString("en-US")}
                        </span>
                        <span className="font-mono text-[10px] text-muted tabular-nums">
                          log {entry.logIndex}
                        </span>
                        {entry.topics.map((topic, topicIdx) => (
                          <span
                            key={`${topic}-${topicIdx}`}
                            className="rounded border border-gold/30 bg-gold/10 px-1.5 py-0.2 font-mono text-[10px] text-gold"
                          >
                            {topic}
                          </span>
                        ))}
                      </div>

                      {entry.inspectorUrl ? (
                        <a
                          href={entry.inspectorUrl}
                          data-testid="timeline-open-inspector-link"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
                        >
                          <span>Open in Contract Inspector</span>
                          <ArrowUpRight className="size-3" aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>

                    <div className="mt-1.5">
                      {entry.decodedSummary ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg">
                          {entry.decodedKind ? (
                            <span className="rounded border border-border bg-bg px-1.5 py-0.2 font-mono text-[10px] text-muted">
                              {entry.decodedKind}
                            </span>
                          ) : null}
                          <span className="break-all">{entry.decodedSummary}</span>
                        </div>
                      ) : (
                        <code className="block break-all font-mono text-[10px] text-muted">
                          {entry.data === "0x" ? "0x (empty payload)" : formatCompactHex(entry.data, 96)}
                        </code>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
