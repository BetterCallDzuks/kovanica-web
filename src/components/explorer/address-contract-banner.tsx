/* eslint-disable react-refresh/only-export-components */
import type { MouseEvent } from "react";
import { ArrowUpRight, FileCode } from "lucide-react";
import { CONTRACT_PRESETS, type ContractPresetId } from "@/lib/contracts/dry-run";
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
  className?: string;
};

/**
 * Auto-detection banner surfaced in the Explorer when a searched or inspected
 * address has deployed WASM contract bytecode, offering a one-click deep-link
 * straight into the Contract Inspector tab.
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
  className,
}: AddressContractBannerProps) {
  const trimmed = typeof address === "string" ? address.trim() : "";
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

  const canonicalAddress = toCanonicalAddress(trimmed) ?? trimmed;
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

  return (
    <div
      data-testid="address-contract-banner"
      role="region"
      aria-label="Deployed WASM Contract Detected"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-gold/35 bg-gold/10 px-4 py-3 text-xs md:px-6",
        className,
      )}
    >
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
  );
}
