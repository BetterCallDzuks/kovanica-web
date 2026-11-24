import { useEffect, useMemo, useState } from "react";
import { Check, Code2, Copy, Database, KeyRound, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, apiPostJson } from "@/lib/api/client";
import type { ApiSource } from "@/lib/api/contract";
import type { ContractStorageResponse } from "@/lib/contracts/dry-run";
import {
  MAPPING_TEMPLATES,
  STORAGE_KEY_PREFIXES,
  decodeStorageValue,
  deriveSlotByMode,
  type MappingKeyEncoding,
  type StorageSlotMode,
} from "@/lib/explorer/storage-slot";
import { cn } from "@/lib/utils";
import { toCanonicalAddress } from "@/lib/wallet/address";

export type StorageSlotReaderProps = {
  source: ApiSource;
  /** Pre-filled contract address when inspecting a contract in the Explorer. */
  contractAddress?: string;
};

const SLOT_MODES: ReadonlyArray<{ id: StorageSlotMode; label: string }> = [
  { id: "raw_hex", label: "Raw Hex" },
  { id: "utf8", label: "UTF-8 Key" },
  { id: "mapping", label: "Mapping Key" },
];

const MAPPING_ENCODINGS: ReadonlyArray<{ id: MappingKeyEncoding; label: string }> = [
  { id: "utf8", label: "UTF-8" },
  { id: "address_or_hex32", label: "Address / 32B Hex" },
  { id: "u64le", label: "u64 LE" },
  { id: "hex", label: "Raw Hex" },
];

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Clipboard may be unavailable in non-secure contexts
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-subtle transition-colors hover:bg-surface-2 hover:text-fg"
      title={`Copy ${label}`}
    >
      {copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/**
 * Compact Contract Storage Slot Deriver & Live Reader UI.
 *
 * Derives 32-byte BLAKE3 storage slots matching `kovanica-sdk`'s `deriveStorageSlotHex`
 * (raw 32-byte hex, UTF-8 string keys, and composite prefix + key mappings) and reads
 * live on-chain storage via `POST /api/contract_storage` (`kovanica_getStorageAt`).
 */
export function StorageSlotReader({ source, contractAddress }: StorageSlotReaderProps) {
  const [address, setAddress] = useState<string>(() => contractAddress?.trim() ?? "");
  const [mode, setMode] = useState<StorageSlotMode>("utf8");

  const [rawHex, setRawHex] = useState<string>(
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  );
  const [utf8Key, setUtf8Key] = useState<string>(STORAGE_KEY_PREFIXES.STATE);
  const [mappingPrefix, setMappingPrefix] = useState<string>(STORAGE_KEY_PREFIXES.NAME);
  const [mappingKey, setMappingKey] = useState<string>("alice");
  const [mappingEncoding, setMappingEncoding] = useState<MappingKeyEncoding>("utf8");
  const [lowercaseUtf8, setLowercaseUtf8] = useState<boolean>(true);

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ContractStorageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (contractAddress?.trim()) {
      setAddress(contractAddress.trim());
    }
  }, [contractAddress]);

  const canonicalAddress = useMemo(() => {
    const trimmed = address.trim();
    return trimmed ? toCanonicalAddress(trimmed) : null;
  }, [address]);

  const addressValid = address.trim().length > 0 && canonicalAddress !== null;

  const derived = useMemo(() => {
    if (mode === "raw_hex") {
      return deriveSlotByMode({ mode: "raw_hex", rawHex });
    }
    if (mode === "utf8") {
      return deriveSlotByMode({ mode: "utf8", utf8Key });
    }
    return deriveSlotByMode({
      mode: "mapping",
      prefix: mappingPrefix,
      key: mappingKey,
      encoding: mappingEncoding,
      lowercaseUtf8,
    });
  }, [mode, rawHex, utf8Key, mappingPrefix, mappingKey, mappingEncoding, lowercaseUtf8]);

  const decoded = useMemo(() => {
    if (!response) return null;
    return decodeStorageValue(response.storageHex);
  }, [response]);

  function applyMappingTemplate(templateId: string) {
    const tpl = MAPPING_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    setMappingPrefix(tpl.prefix);
    setMappingEncoding(tpl.encoding);
    setMappingKey(tpl.sampleKey);
    setLowercaseUtf8(Boolean(tpl.lowercase));
    setResponse(null);
    setError(null);
  }

  async function handleReadSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!addressValid) {
      setError("Enter a valid contract address (kvnc…dag or 32-byte hex).");
      return;
    }
    if (!derived.ok) {
      setError(derived.error);
      return;
    }

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await apiPostJson<ContractStorageResponse>("/api/contract_storage", {
        contract: address.trim(),
        slot: derived.slotHex,
        schemaHint: "auto",
      });
      setResponse(res);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Storage slot read failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const canRead = !loading && addressValid && derived.ok;

  return (
    <section
      aria-label="Storage Slot Deriver and Live Reader"
      data-testid="storage-slot-reader-panel"
      className="space-y-4 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <KeyRound className="size-4 text-gold" />
            <h3 className="font-display text-base text-fg">
              Storage Slot Deriver &amp; Live Reader
            </h3>
            <span className="inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 font-mono text-[10px] font-medium text-gold">
              deriveStorageSlotHex · kovanica_getStorageAt
            </span>
          </div>
          <p className="max-w-3xl text-xs text-muted">
            Derive canonical SDK-compatible BLAKE3 storage slots (raw 32-byte hex, UTF-8 keys, or{" "}
            <code className="font-mono text-fg">prefix || key</code> mappings) and read live values
            via <code className="font-mono text-fg">kovanica_getStorageAt</code>.
          </p>
        </div>
        <span className="font-mono text-[10px] text-subtle">target · {source}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        {/* Left: Contract Address + Slot Deriver Form */}
        <form onSubmit={(e) => void handleReadSlot(e)} className="space-y-3.5">
          {/* Contract Address */}
          <div className="space-y-1">
            <label
              htmlFor="slot-reader-contract-address"
              className="block font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase"
            >
              1. Contract Address
            </label>
            <input
              id="slot-reader-contract-address"
              data-testid="slot-reader-contract-input"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="kvnc…dag or 64-char hex contract address"
              spellCheck={false}
              autoComplete="off"
              className={cn(
                "w-full rounded-md border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-subtle focus:outline-none focus:ring-1",
                address.trim() && !addressValid
                  ? "border-danger/60 focus:ring-danger"
                  : "border-border focus:border-gold/60 focus:ring-gold/40",
              )}
            />
            {address.trim() && !addressValid ? (
              <p className="font-mono text-[11px] text-danger">
                Must be a valid canonical kvnc…dag address or 32-byte hex string.
              </p>
            ) : null}
          </div>

          {/* Slot Mode Selector */}
          <div className="space-y-2 border-t border-border/60 pt-3">
            <span className="block font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase">
              2. Slot Derivation Mode
            </span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Slot derivation mode">
              {SLOT_MODES.map((m) => {
                const active = m.id === mode;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`slot-mode-${m.id}`}
                    aria-pressed={active}
                    onClick={() => {
                      setMode(m.id);
                      setResponse(null);
                      setError(null);
                    }}
                    className={cn(
                      "rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors",
                      active
                        ? "border-gold/60 bg-gold/15 font-semibold text-gold"
                        : "border-border bg-bg/60 text-muted hover:border-border/80 hover:text-fg",
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>

            {mode === "raw_hex" ? (
              <div className="space-y-1">
                <label
                  htmlFor="slot-reader-raw-hex"
                  className="block text-xs font-medium text-fg"
                >
                  32-Byte Storage Slot Hex
                </label>
                <input
                  id="slot-reader-raw-hex"
                  data-testid="slot-reader-raw-hex-input"
                  type="text"
                  value={rawHex}
                  onChange={(e) => setRawHex(e.target.value)}
                  placeholder="0x… (64 hex characters)"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40"
                />
              </div>
            ) : null}

            {mode === "utf8" ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="slot-reader-utf8-key"
                    className="text-xs font-medium text-fg"
                  >
                    UTF-8 Storage Key
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                    <button
                      type="button"
                      onClick={() => setUtf8Key(STORAGE_KEY_PREFIXES.STATE)}
                      className="rounded border border-border bg-bg/60 px-1.5 py-0.5 text-muted hover:border-gold/50 hover:text-gold"
                    >
                      kvnc/v1/state
                    </button>
                    <button
                      type="button"
                      onClick={() => setUtf8Key(STORAGE_KEY_PREFIXES.POOL)}
                      className="rounded border border-border bg-bg/60 px-1.5 py-0.5 text-muted hover:border-gold/50 hover:text-gold"
                    >
                      kvnc/v1/pool
                    </button>
                  </div>
                </div>
                <input
                  id="slot-reader-utf8-key"
                  data-testid="slot-reader-utf8-input"
                  type="text"
                  value={utf8Key}
                  onChange={(e) => setUtf8Key(e.target.value)}
                  placeholder="e.g. kvnc/v1/state"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40"
                />
              </div>
            ) : null}

            {mode === "mapping" ? (
              <div className="space-y-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {MAPPING_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => applyMappingTemplate(tpl.id)}
                      className={cn(
                        "rounded border px-2 py-0.5 font-mono text-[10px] transition-colors",
                        mappingPrefix === tpl.prefix
                          ? "border-gold/50 bg-gold/10 text-gold"
                          : "border-border bg-bg/60 text-muted hover:text-fg",
                      )}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>

                <div className="grid gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <div className="space-y-1">
                    <label
                      htmlFor="slot-reader-mapping-prefix"
                      className="block text-xs font-medium text-fg"
                    >
                      Prefix (UTF-8)
                    </label>
                    <input
                      id="slot-reader-mapping-prefix"
                      data-testid="slot-reader-mapping-prefix-input"
                      type="text"
                      value={mappingPrefix}
                      onChange={(e) => setMappingPrefix(e.target.value)}
                      placeholder="kvnc/v1/lp/"
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="slot-reader-mapping-key"
                      className="block text-xs font-medium text-fg"
                    >
                      Key
                    </label>
                    <input
                      id="slot-reader-mapping-key"
                      data-testid="slot-reader-mapping-key-input"
                      type="text"
                      value={mappingKey}
                      onChange={(e) => setMappingKey(e.target.value)}
                      placeholder="address, hex32, u64, or UTF-8 key"
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-subtle focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 font-mono text-[10px] text-subtle uppercase">
                      Key Encoding:
                    </span>
                    {MAPPING_ENCODINGS.map((enc) => (
                      <button
                        key={enc.id}
                        type="button"
                        onClick={() => setMappingEncoding(enc.id)}
                        className={cn(
                          "rounded border px-2 py-0.5 font-mono text-[10px] transition-colors",
                          mappingEncoding === enc.id
                            ? "border-gold/50 bg-gold/15 text-gold"
                            : "border-border bg-bg/60 text-muted hover:text-fg",
                        )}
                      >
                        {enc.label}
                      </button>
                    ))}
                  </div>
                  {mappingEncoding === "utf8" ? (
                    <label className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted">
                      <input
                        type="checkbox"
                        checked={lowercaseUtf8}
                        onChange={(e) => setLowercaseUtf8(e.target.checked)}
                        className="accent-gold"
                      />
                      <span>lowercase key</span>
                    </label>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {/* Live Derived Slot Preview */}
          <div className="rounded-md border border-border/70 bg-bg/70 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-subtle uppercase">
                <Code2 className="size-3 text-gold" />
                Derived Slot Hex
              </span>
              {derived.ok ? (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted">
                    {derived.derivationLabel} ({derived.preimageBytes} B)
                  </span>
                  <CopyButton text={derived.slotHex} label="Derived Slot Hex" />
                </div>
              ) : null}
            </div>
            {derived.ok ? (
              <p
                data-testid="slot-reader-derived-hex"
                className="mt-1.5 break-all font-mono text-[11px] text-fg select-all"
              >
                {derived.slotHex}
              </p>
            ) : (
              <p className="mt-1.5 font-mono text-[11px] text-amber-300">{derived.error}</p>
            )}
          </div>

          <div className="flex justify-end pt-1">
            <Button
              type="submit"
              variant="gold"
              size="sm"
              data-testid="slot-reader-submit-btn"
              disabled={!canRead}
              className="h-9 gap-1.5 px-4 text-xs"
            >
              {loading ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <span>Reading Slot…</span>
                </>
              ) : (
                <>
                  <Search className="size-3.5" />
                  <span>Read Slot (kovanica_getStorageAt)</span>
                </>
              )}
            </Button>
          </div>
        </form>

        {/* Right: Decoded Storage Result View */}
        <div
          aria-live="polite"
          data-testid="slot-reader-result"
          className="flex flex-col gap-3 rounded-md border border-border bg-bg/50 p-3.5"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-subtle uppercase">
              Decoded Storage Value
            </span>
            {response && decoded ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold",
                  decoded.isEmpty
                    ? "border-border bg-surface text-muted"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                )}
              >
                {decoded.isEmpty ? "Empty Slot" : `${decoded.byteLength} B · ${response.latencyMs} ms`}
              </span>
            ) : error ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
                Error
              </span>
            ) : (
              <span className="font-mono text-[10px] text-subtle">Idle</span>
            )}
          </div>

          {!response && !error && !loading ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded border border-dashed border-border/70 bg-bg/40 p-6 text-center">
              <Database className="size-7 text-subtle" />
              <p className="mt-2 text-xs font-medium text-fg">
                Derive a slot and read live contract storage
              </p>
              <p className="mt-1 max-w-xs text-[11px] text-muted">
                Choose Raw Hex, UTF-8 Key, or Mapping Key and click Read Slot to query{" "}
                <code className="font-mono text-fg">kovanica_getStorageAt</code> and inspect hex,
                integer, address, and UTF-8 decodings.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="rounded border border-danger/30 bg-danger/10 p-3 font-mono text-xs text-danger">
              {error}
            </div>
          ) : null}

          {response && decoded ? (
            <div className="space-y-3 font-mono text-xs">
              {/* Raw Hex Value */}
              <div className="rounded border border-border/70 bg-bg/80 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold tracking-wider text-subtle uppercase">
                    Raw Hex
                  </span>
                  <CopyButton text={decoded.rawHex} label="Raw Storage Value Hex" />
                </div>
                <p
                  data-testid="slot-reader-raw-value"
                  className="mt-1 max-h-24 overflow-auto break-all text-[11px] text-fg select-all"
                >
                  {decoded.rawHex}
                </p>
              </div>

              {/* Decoded Interpretations */}
              {decoded.isEmpty ? (
                <div className="rounded border border-border/60 bg-bg/70 p-3 text-xs text-muted">
                  Storage slot is empty ({decoded.byteLength === 0 ? "0 bytes" : "all-zero 32 bytes"}).
                </div>
              ) : (
                <dl className="grid gap-2 rounded border border-border bg-bg/80 p-3 text-xs sm:grid-cols-2">
                  {decoded.utf8Preview !== null ? (
                    <div className="sm:col-span-2">
                      <dt className="text-[10px] text-subtle uppercase">UTF-8 Preview</dt>
                      <dd className="mt-0.5 break-all text-gold">{decoded.utf8Preview}</dd>
                    </div>
                  ) : null}

                  {decoded.address !== null ? (
                    <div className="sm:col-span-2">
                      <dt className="text-[10px] text-subtle uppercase">Address (PRO-21)</dt>
                      <dd className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="break-all text-gold">{decoded.address}</span>
                        <CopyButton text={decoded.address} label="Decoded Address" />
                      </dd>
                    </div>
                  ) : null}

                  {decoded.u64Le !== null ? (
                    <div>
                      <dt className="text-[10px] text-subtle uppercase">u64 (Little-Endian)</dt>
                      <dd className="mt-0.5 tabular-nums text-fg">{decoded.u64Le}</dd>
                    </div>
                  ) : null}

                  {decoded.u64Be !== null ? (
                    <div>
                      <dt className="text-[10px] text-subtle uppercase">u64 (Big-Endian)</dt>
                      <dd className="mt-0.5 tabular-nums text-fg">{decoded.u64Be}</dd>
                    </div>
                  ) : null}

                  {decoded.u128Le !== null ? (
                    <div>
                      <dt className="text-[10px] text-subtle uppercase">u128 (Little-Endian)</dt>
                      <dd className="mt-0.5 break-all tabular-nums text-fg">{decoded.u128Le}</dd>
                    </div>
                  ) : null}

                  {decoded.u128Be !== null ? (
                    <div>
                      <dt className="text-[10px] text-subtle uppercase">u128 (Big-Endian)</dt>
                      <dd className="mt-0.5 break-all tabular-nums text-fg">{decoded.u128Be}</dd>
                    </div>
                  ) : null}

                  {decoded.u256Be !== null ? (
                    <div className="sm:col-span-2">
                      <dt className="text-[10px] text-subtle uppercase">u256 (Big-Endian)</dt>
                      <dd className="mt-0.5 break-all tabular-nums text-muted">{decoded.u256Be}</dd>
                    </div>
                  ) : null}

                  {decoded.utf8Preview === null &&
                  decoded.address === null &&
                  decoded.u64Le === null &&
                  decoded.u64Be === null &&
                  decoded.u128Le === null &&
                  decoded.u128Be === null &&
                  decoded.u256Be === null ? (
                    <div className="sm:col-span-2 text-muted">
                      Opaque binary payload ({decoded.byteLength} bytes).
                    </div>
                  ) : null}
                </dl>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
