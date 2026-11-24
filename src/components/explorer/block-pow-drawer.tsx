import { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, ShieldCheck } from "lucide-react";
import type { ApiDagBlock } from "@/lib/api/contract";
import type { Block } from "@/lib/ledger/types";
import {
  extractBlockPowProof,
  formatPowSummaryBadge,
} from "@/lib/explorer/block-pow-inspector";
import { cn } from "@/lib/utils";

export type BlockPowDrawerProps = {
  block: Block | null;
  apiBlock?: ApiDagBlock | null;
  defaultOpen?: boolean;
};

type CopyableFieldKey = "pow_hash" | "state_root" | "tx_merkle_root" | "nonce";

/**
 * Collapsible Block Header & PoW Proof Inspector drawer for the Explorer block detail card.
 *
 * Displays `target_bits`, `difficulty`, `pow_hash`, `nonce`, `state_root`,
 * `tx_merkle_root`, and `pow_timestamp` with copy-to-clipboard actions for hashes and roots.
 */
export function BlockPowDrawer({
  block,
  apiBlock = null,
  defaultOpen = false,
}: BlockPowDrawerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [copiedKey, setCopiedKey] = useState<CopyableFieldKey | null>(null);

  const proof = useMemo(
    () => extractBlockPowProof(block, apiBlock),
    [block, apiBlock],
  );
  const summaryBadge = useMemo(() => formatPowSummaryBadge(proof), [proof]);

  const handleCopy = useCallback(async (key: CopyableFieldKey, value: string | null) => {
    if (!value) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1500);
    } catch {
      // Ignore clipboard permission errors in restricted contexts
    }
  }, []);

  if (!block && !apiBlock) {
    return null;
  }

  return (
    <div
      data-testid="block-pow-drawer"
      className="mt-3 rounded-md border border-border/80 bg-bg/60"
    >
      <button
        type="button"
        data-testid="block-pow-drawer-toggle"
        aria-expanded={open}
        aria-controls="block-pow-drawer-panel"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-surface/60"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ShieldCheck className="size-3.5 shrink-0 text-gold" />
          <span className="text-xs font-medium text-fg">
            Header &amp; PoW Proof
          </span>
          <span
            data-testid="block-pow-summary"
            className="hidden truncate rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline-block"
          >
            {summaryBadge}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-subtle">
          <span>
            {proof.populatedCount}/{proof.totalFields}
          </span>
          {open ? (
            <ChevronUp className="size-3.5 text-subtle" />
          ) : (
            <ChevronDown className="size-3.5 text-subtle" />
          )}
        </span>
      </button>

      {open ? (
        <div
          id="block-pow-drawer-panel"
          data-testid="block-pow-drawer-content"
          className="border-t border-border/70 px-3 py-3"
        >
          <dl className="grid gap-2.5 text-xs sm:grid-cols-2">
            {/* target_bits */}
            <div className="rounded border border-border/60 bg-surface/50 px-2.5 py-2">
              <dt className="font-mono text-[10px] tracking-wider text-subtle uppercase">
                target_bits
              </dt>
              <dd
                data-testid="pow-field-target-bits"
                title={proof.targetHex ? `Expanded target: ${proof.targetHex}` : undefined}
                className="mt-1 font-mono text-xs font-medium tabular-nums text-fg"
              >
                {proof.targetBitsHex}
              </dd>
            </div>

            {/* difficulty */}
            <div className="rounded border border-border/60 bg-surface/50 px-2.5 py-2">
              <div className="flex items-center justify-between gap-1.5">
                <dt className="font-mono text-[10px] tracking-wider text-subtle uppercase">
                  difficulty
                </dt>
                {proof.difficultySource !== "unavailable" ? (
                  <span className="rounded bg-gold/10 px-1 py-0.2 font-mono text-[9px] text-gold uppercase">
                    {proof.difficultySource}
                  </span>
                ) : null}
              </div>
              <dd
                data-testid="pow-field-difficulty"
                className="mt-1 font-mono text-xs font-medium tabular-nums text-fg"
              >
                {proof.difficultyFormatted}
              </dd>
            </div>

            {/* nonce */}
            <div className="rounded border border-border/60 bg-surface/50 px-2.5 py-2">
              <div className="flex items-center justify-between gap-1.5">
                <dt className="font-mono text-[10px] tracking-wider text-subtle uppercase">
                  nonce
                </dt>
                {proof.nonce !== null ? (
                  <CopyFieldButton
                    testId="pow-copy-nonce"
                    label="Copy nonce"
                    copied={copiedKey === "nonce"}
                    onClick={() => void handleCopy("nonce", proof.nonce)}
                  />
                ) : null}
              </div>
              <dd
                data-testid="pow-field-nonce"
                className="mt-1 flex flex-wrap items-baseline gap-x-2 font-mono text-xs font-medium tabular-nums text-fg"
              >
                <span>{proof.nonceDisplay}</span>
                {proof.nonceHex ? (
                  <span className="text-[10px] text-subtle">{proof.nonceHex}</span>
                ) : null}
              </dd>
            </div>

            {/* pow_timestamp */}
            <div className="rounded border border-border/60 bg-surface/50 px-2.5 py-2">
              <div className="flex items-center justify-between gap-1.5">
                <dt className="font-mono text-[10px] tracking-wider text-subtle uppercase">
                  pow_timestamp
                </dt>
                {proof.powTimestampSource === "block_timestamp" ? (
                  <span className="rounded bg-border/60 px-1 py-0.2 font-mono text-[9px] text-muted uppercase">
                    block ts
                  </span>
                ) : null}
              </div>
              <dd
                data-testid="pow-field-pow-timestamp"
                className="mt-1 break-all font-mono text-xs tabular-nums text-fg"
              >
                {proof.powTimestampIso}
              </dd>
            </div>

            {/* pow_hash */}
            <HashRow
              label="pow_hash"
              value={proof.powHashDisplay}
              copyValue={proof.powHash}
              fieldTestId="pow-field-pow-hash"
              copyTestId="pow-copy-pow-hash"
              copied={copiedKey === "pow_hash"}
              onCopy={() => void handleCopy("pow_hash", proof.powHash)}
            />

            {/* state_root */}
            <HashRow
              label="state_root"
              value={proof.stateRootDisplay}
              copyValue={proof.stateRoot}
              fieldTestId="pow-field-state-root"
              copyTestId="pow-copy-state-root"
              copied={copiedKey === "state_root"}
              onCopy={() => void handleCopy("state_root", proof.stateRoot)}
            />

            {/* tx_merkle_root */}
            <HashRow
              label="tx_merkle_root"
              value={proof.txMerkleRootDisplay}
              copyValue={proof.txMerkleRoot}
              fieldTestId="pow-field-tx-merkle-root"
              copyTestId="pow-copy-tx-merkle-root"
              copied={copiedKey === "tx_merkle_root"}
              onCopy={() => void handleCopy("tx_merkle_root", proof.txMerkleRoot)}
            />
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function HashRow({
  label,
  value,
  copyValue,
  fieldTestId,
  copyTestId,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copyValue: string | null;
  fieldTestId: string;
  copyTestId: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded border border-border/60 bg-surface/50 px-2.5 py-2 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <dt className="font-mono text-[10px] tracking-wider text-subtle uppercase">
          {label}
        </dt>
        {copyValue ? (
          <CopyFieldButton
            testId={copyTestId}
            label={`Copy ${label}`}
            copied={copied}
            onClick={onCopy}
          />
        ) : null}
      </div>
      <dd
        data-testid={fieldTestId}
        className={cn(
          "mt-1 break-all font-mono text-[11px]",
          copyValue ? "text-fg" : "text-muted",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function CopyFieldButton({
  testId,
  label,
  copied,
  onClick,
}: {
  testId: string;
  label: string;
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded border border-border/80 bg-bg px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-gold/50 hover:text-fg"
    >
      {copied ? (
        <>
          <Check className="size-2.5 text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <Copy className="size-2.5" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}
